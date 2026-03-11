"""Generate the students.xlsx sample data file."""
import pandas as pd

students = [
    {"RegNo": "2024CSE001", "Name": "Aarav Sharma", "Department": "B.Sc. CS", "Class": "B.Sc. CS", "Barcode": "ID2024CSE001"},
    {"RegNo": "2024CSE002", "Name": "Priya Nair", "Department": "B.Sc. CSDA", "Class": "B.Sc. CSDA", "Barcode": "ID2024CSE002"},
    {"RegNo": "2024CSE003", "Name": "Karthik Rajan", "Department": "B.com.", "Class": "B.com.", "Barcode": "ID2024CSE003"},
    {"RegNo": "2024ECE001", "Name": "Sneha Reddy", "Department": "B.com. CA", "Class": "B.com. CA", "Barcode": "ID2024ECE001"},
    {"RegNo": "2024ECE002", "Name": "Rohan Kumar", "Department": "B.com. PA", "Class": "B.com. PA", "Barcode": "ID2024ECE002"},
    {"RegNo": "2024ECE003", "Name": "Divya Patel", "Department": "B.com IT", "Class": "B.com IT", "Barcode": "ID2024ECE003"},
    {"RegNo": "2024MECH001", "Name": "Arjun Singh", "Department": "BBA CA", "Class": "BBA CA", "Barcode": "ID2024MECH001"},
    {"RegNo": "2024MECH002", "Name": "Meera Iyer", "Department": "B.Sc. CSHM", "Class": "B.Sc. CSHM", "Barcode": "ID2024MECH002"},
    {"RegNo": "2024EEE001", "Name": "Vikram Das", "Department": "B.Sc. IT", "Class": "B.Sc. IT", "Barcode": "ID2024EEE001"},
    {"RegNo": "2024EEE002", "Name": "Anjali Menon", "Department": "B.Sc. CS", "Class": "B.Sc. CS", "Barcode": "ID2024EEE002"},
    {"RegNo": "2024CSE004", "Name": "Rahul Verma", "Department": "B.com. CA", "Class": "B.com. CA", "Barcode": "ID2024CSE004"},
    {"RegNo": "2024ECE004", "Name": "Lakshmi Bhat", "Department": "B.Sc. CSDA", "Class": "B.Sc. CSDA", "Barcode": "ID2024ECE004"},
]

df = pd.DataFrame(students)
df.to_excel("students.xlsx", index=False, engine="openpyxl")
print(f"Created students.xlsx with {len(df)} records")
