"""
RFID / Barcode Based Student Attendance Management System
Flask Backend
"""

from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import os
from datetime import datetime
import barcode
from barcode.writer import ImageWriter

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STUDENTS_FILE = os.path.join(BASE_DIR, "students.xlsx")
ATTENDANCE_DIR = os.path.join(BASE_DIR, "attendance_records")
BARCODES_DIR = os.path.join(BASE_DIR, "static", "barcodes")
STUDENT_COLUMNS = ["RegNo", "Name", "Department", "Class", "Barcode"]

# Ensure directories exist
os.makedirs(ATTENDANCE_DIR, exist_ok=True)
os.makedirs(BARCODES_DIR, exist_ok=True)


def load_students_dataframe():
    """Load students with a backward-compatible schema."""
    if not os.path.exists(STUDENTS_FILE):
        return pd.DataFrame(columns=STUDENT_COLUMNS)

    df = pd.read_excel(STUDENTS_FILE, dtype=str).fillna("")
    df.columns = df.columns.str.strip()

    for column in STUDENT_COLUMNS:
        if column not in df.columns:
            df[column] = ""

    for column in df.columns:
        df[column] = df[column].fillna("").astype(str).str.strip()

    ordered_columns = STUDENT_COLUMNS + [col for col in df.columns if col not in STUDENT_COLUMNS]
    return df[ordered_columns]


def save_students_dataframe(df):
    """Persist students while preserving any extra columns."""
    for column in STUDENT_COLUMNS:
        if column not in df.columns:
            df[column] = ""

    df = df.fillna("")
    ordered_columns = STUDENT_COLUMNS + [col for col in df.columns if col not in STUDENT_COLUMNS]
    df[ordered_columns].to_excel(STUDENTS_FILE, index=False, engine="openpyxl")


def normalize_value(value):
    """Normalize a lookup key for case-insensitive matching."""
    return str(value or "").strip().upper()


def get_student_barcode_value(row):
    """Use the stored barcode when present, otherwise fall back to RegNo."""
    barcode_value = str(row.get("Barcode", "") or "").strip()
    reg_no = str(row.get("RegNo", "") or "").strip()
    return barcode_value or reg_no


def find_student_record(df, identifier):
    """Find a student by register number or stored barcode value."""
    lookup_value = normalize_value(identifier)
    if not lookup_value or df.empty:
        return None

    reg_matches = df["RegNo"].str.strip().str.upper() == lookup_value
    if reg_matches.any():
        return df[reg_matches].iloc[0]

    barcode_matches = df["Barcode"].str.strip().str.upper() == lookup_value
    if barcode_matches.any():
        return df[barcode_matches].iloc[0]

    return None


def generate_student_barcode_asset(reg_no, barcode_value):
    """Generate the barcode image file for a student."""
    code128 = barcode.get_barcode_class("code128")
    image_base_path = os.path.join(BARCODES_DIR, reg_no)
    code128(barcode_value, writer=ImageWriter()).save(image_base_path, options={
        "module_width": 0.4,
        "module_height": 20,
        "font_size": 14,
        "text_distance": 5,
        "quiet_zone": 6,
    })
    return f"/static/barcodes/{reg_no}.png"


# ──────────────────────────────────────────────
# Page Routes
# ──────────────────────────────────────────────

@app.route("/")
def index():
    """Render the barcode scanner page."""
    return render_template("index.html")


@app.route("/dashboard")
def dashboard():
    """Render the attendance dashboard page."""
    return render_template("dashboard.html")


@app.route("/barcodes")
def barcodes_page():
    """Render the barcode generator page."""
    return render_template("barcodes.html")


@app.route("/api/generate-barcode/<reg_no>")
def generate_barcode(reg_no):
    """Generate a barcode image for a given register number."""
    try:
        lookup_value = reg_no.strip()
        student = find_student_record(load_students_dataframe(), lookup_value)

        resolved_reg_no = student["RegNo"].strip() if student is not None else lookup_value
        barcode_value = get_student_barcode_value(student) if student is not None else lookup_value

        return jsonify({
            "barcode_url": generate_student_barcode_asset(resolved_reg_no, barcode_value),
            "reg_no": resolved_reg_no,
            "barcode_value": barcode_value,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/generate-all-barcodes")
def generate_all_barcodes():
    """Generate barcodes for all students."""
    try:
        df = load_students_dataframe()
        results = []

        for _, row in df.iterrows():
            reg_no = row["RegNo"].strip()
            if not reg_no:
                continue

            barcode_value = get_student_barcode_value(row)

            results.append({
                "reg_no": reg_no,
                "name": row["Name"].strip(),
                "department": row["Department"].strip(),
                "class": row["Class"].strip(),
                "barcode_value": barcode_value,
                "barcode_url": generate_student_barcode_asset(reg_no, barcode_value),
            })

        return jsonify({"students": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ──────────────────────────────────────────────
# API Routes
# ──────────────────────────────────────────────

@app.route("/api/student/<reg_no>")
def get_student(reg_no):
    """Look up a student by Register Number or Barcode."""
    try:
        student = find_student_record(load_students_dataframe(), reg_no)

        if student is None:
            return jsonify({"error": "Student not found"}), 404

        return jsonify({
            "reg_no": student["RegNo"].strip(),
            "name": student["Name"].strip(),
            "department": student["Department"].strip(),
            "class": student["Class"].strip(),
            "barcode": get_student_barcode_value(student),
        })

    except FileNotFoundError:
        return jsonify({"error": "Students database file not found"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/students", methods=["POST"])
def add_student():
    """Add a student to the students database."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    name = data.get("name", "").strip()
    reg_no = data.get("reg_no", "").strip()
    student_class = data.get("class", "").strip()
    barcode_value = data.get("barcode", "").strip()
    department = data.get("department", "").strip()

    if not name or not reg_no or not student_class or not barcode_value:
        return jsonify({"error": "Name, RegNo, Class, and Barcode are required"}), 400

    try:
        df = load_students_dataframe()
        reg_lookup = normalize_value(reg_no)
        barcode_lookup = normalize_value(barcode_value)

        if reg_lookup in df["RegNo"].str.strip().str.upper().tolist():
            return jsonify({"error": "RegNo already exists"}), 409
        if reg_lookup in df["Barcode"].str.strip().str.upper().tolist():
            return jsonify({"error": "RegNo matches an existing barcode"}), 409
        if barcode_lookup in df["Barcode"].str.strip().str.upper().tolist():
            return jsonify({"error": "Barcode already exists"}), 409
        if barcode_lookup in df["RegNo"].str.strip().str.upper().tolist():
            return jsonify({"error": "Barcode matches an existing RegNo"}), 409

        new_student = pd.DataFrame([{
            "RegNo": reg_no,
            "Name": name,
            "Department": department,
            "Class": student_class,
            "Barcode": barcode_value,
        }])
        combined = pd.concat([df, new_student], ignore_index=True)
        save_students_dataframe(combined)

        return jsonify({
            "message": "Student added successfully",
            "student": {
                "reg_no": reg_no,
                "name": name,
                "department": department,
                "class": student_class,
                "barcode": barcode_value,
                "barcode_url": generate_student_barcode_asset(reg_no, barcode_value),
            },
        }), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/attendance", methods=["POST"])
def submit_attendance():
    """Record attendance for a student (with duplicate prevention)."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    reg_no = data.get("reg_no", "").strip()
    name = data.get("name", "").strip()
    department = data.get("department", "").strip()
    student_class = data.get("class", "").strip()

    if not reg_no or not name:
        return jsonify({"error": "Missing required fields"}), 400

    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M:%S")
    filename = f"attendance_{date_str}.xlsx"
    filepath = os.path.join(ATTENDANCE_DIR, filename)

    # ── Duplicate Check ──
    if os.path.exists(filepath):
        existing = pd.read_excel(filepath, dtype=str)
        existing.columns = existing.columns.str.strip()
        if reg_no.upper() in existing["Register Number"].str.strip().str.upper().values:
            return jsonify({
                "error": "Attendance already recorded today.",
                "duplicate": True
            }), 409

    # ── Save Record ──
    new_record = pd.DataFrame([{
        "Date": date_str,
        "Time": time_str,
        "Register Number": reg_no,
        "Name": name,
        "Department": department,
        "Class": student_class,
    }])

    if os.path.exists(filepath):
        existing = pd.read_excel(filepath, dtype=str)
        existing.columns = existing.columns.str.strip()
        combined = pd.concat([existing, new_record], ignore_index=True)
    else:
        combined = new_record

    combined.to_excel(filepath, index=False, engine="openpyxl")

    return jsonify({
        "message": "Attendance recorded successfully!",
        "date": date_str,
        "time": time_str,
    })


@app.route("/api/attendance", methods=["GET"])
def get_attendance():
    """Retrieve attendance records with optional filters."""
    date_filter = request.args.get("date", "")
    dept_filter = request.args.get("department", "")
    reg_filter = request.args.get("reg_no", "")

    all_records = []

    for filename in sorted(os.listdir(ATTENDANCE_DIR)):
        if filename.startswith("attendance_") and filename.endswith(".xlsx"):
            # If a date filter is provided, skip non-matching files
            if date_filter:
                file_date = filename.replace("attendance_", "").replace(".xlsx", "")
                if file_date != date_filter:
                    continue

            filepath = os.path.join(ATTENDANCE_DIR, filename)
            try:
                df = pd.read_excel(filepath, dtype=str)
                df.columns = df.columns.str.strip()
                all_records.append(df)
            except Exception:
                continue

    if not all_records:
        return jsonify({"records": [], "departments": get_all_departments()})

    combined = pd.concat(all_records, ignore_index=True)

    # Apply filters
    if dept_filter:
        combined = combined[combined["Department"].str.strip().str.upper() == dept_filter.strip().upper()]
    if reg_filter:
        combined = combined[combined["Register Number"].str.strip().str.upper().str.contains(reg_filter.strip().upper())]

    records = combined.to_dict(orient="records")
    return jsonify({"records": records, "departments": get_all_departments()})


@app.route("/api/export")
def export_attendance():
    """Export filtered attendance records as an Excel file."""
    date_filter = request.args.get("date", "")
    dept_filter = request.args.get("department", "")
    reg_filter = request.args.get("reg_no", "")

    all_records = []

    for filename in sorted(os.listdir(ATTENDANCE_DIR)):
        if filename.startswith("attendance_") and filename.endswith(".xlsx"):
            if date_filter:
                file_date = filename.replace("attendance_", "").replace(".xlsx", "")
                if file_date != date_filter:
                    continue

            filepath = os.path.join(ATTENDANCE_DIR, filename)
            try:
                df = pd.read_excel(filepath, dtype=str)
                df.columns = df.columns.str.strip()
                all_records.append(df)
            except Exception:
                continue

    if not all_records:
        # Return empty Excel
        empty_df = pd.DataFrame(columns=["Date", "Time", "Register Number", "Name", "Department", "Class"])
        export_path = os.path.join(ATTENDANCE_DIR, "export_temp.xlsx")
        empty_df.to_excel(export_path, index=False, engine="openpyxl")
        return send_file(export_path, as_attachment=True, download_name="attendance_export.xlsx")

    combined = pd.concat(all_records, ignore_index=True)

    if dept_filter:
        combined = combined[combined["Department"].str.strip().str.upper() == dept_filter.strip().upper()]
    if reg_filter:
        combined = combined[combined["Register Number"].str.strip().str.upper().str.contains(reg_filter.strip().upper())]

    export_path = os.path.join(ATTENDANCE_DIR, "export_temp.xlsx")
    combined.to_excel(export_path, index=False, engine="openpyxl")

    return send_file(
        export_path,
        as_attachment=True,
        download_name=f"attendance_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx",
    )


@app.route("/api/stats")
def get_stats():
    """Get attendance statistics."""
    today = datetime.now().strftime("%Y-%m-%d")
    today_file = os.path.join(ATTENDANCE_DIR, f"attendance_{today}.xlsx")

    total_today = 0
    dept_counts = {}

    if os.path.exists(today_file):
        try:
            df = pd.read_excel(today_file, dtype=str)
            df.columns = df.columns.str.strip()
            total_today = len(df)
            departments = df["Department"].fillna("").astype(str).str.strip()
            dept_counts = departments[departments != ""].value_counts().to_dict()
        except Exception:
            pass

    # Total students
    total_students = 0
    try:
        students_df = load_students_dataframe()
        total_students = len(students_df)
    except Exception:
        pass

    return jsonify({
        "total_today": total_today,
        "total_students": total_students,
        "department_counts": dept_counts,
    })


def get_all_departments():
    """Get list of all departments from student database."""
    try:
        df = load_students_dataframe()
        departments = df["Department"].str.strip()
        return sorted(departments[departments != ""].unique().tolist())
    except Exception:
        return []


if __name__ == "__main__":
    debug_enabled = os.environ.get("ATTENDANCE_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(debug=debug_enabled, host="0.0.0.0", port=5000)
