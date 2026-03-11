"""Generate the students.xlsx sample data file."""
import pandas as pd

students = [
    {"RegNo": "2024CSE001", "Name": "Aarav Sharma", "Department": "CSE", "Class": "III Year A", "Barcode": "ID2024CSE001"},
    {"RegNo": "2024CSE002", "Name": "Priya Nair", "Department": "CSE", "Class": "III Year A", "Barcode": "ID2024CSE002"},
    {"RegNo": "2024CSE003", "Name": "Karthik Rajan", "Department": "CSE", "Class": "III Year B", "Barcode": "ID2024CSE003"},
    {"RegNo": "2024ECE001", "Name": "Sneha Reddy", "Department": "ECE", "Class": "II Year A", "Barcode": "ID2024ECE001"},
    {"RegNo": "2024ECE002", "Name": "Rohan Kumar", "Department": "ECE", "Class": "II Year A", "Barcode": "ID2024ECE002"},
    {"RegNo": "2024ECE003", "Name": "Divya Patel", "Department": "ECE", "Class": "II Year B", "Barcode": "ID2024ECE003"},
    {"RegNo": "2024MECH001", "Name": "Arjun Singh", "Department": "MECH", "Class": "IV Year A", "Barcode": "ID2024MECH001"},
    {"RegNo": "2024MECH002", "Name": "Meera Iyer", "Department": "MECH", "Class": "IV Year A", "Barcode": "ID2024MECH002"},
    {"RegNo": "2024EEE001", "Name": "Vikram Das", "Department": "EEE", "Class": "I Year A", "Barcode": "ID2024EEE001"},
    {"RegNo": "2024EEE002", "Name": "Anjali Menon", "Department": "EEE", "Class": "I Year A", "Barcode": "ID2024EEE002"},
    {"RegNo": "2024CSE004", "Name": "Rahul Verma", "Department": "CSE", "Class": "III Year B", "Barcode": "ID2024CSE004"},
    {"RegNo": "2024ECE004", "Name": "Lakshmi Bhat", "Department": "ECE", "Class": "II Year B", "Barcode": "ID2024ECE004"},
]

df = pd.DataFrame(students)
df.to_excel("students.xlsx", index=False, engine="openpyxl")
print(f"Created students.xlsx with {len(df)} records")
