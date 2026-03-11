/**
 * dashboard.js - Attendance Dashboard Logic
 * Handles fetching records, filtering, rendering table, exporting, and stats.
 */

(function () {
    "use strict";

    const filterReg = document.getElementById("filter-reg");
    const filterDept = document.getElementById("filter-dept");
    const filterDate = document.getElementById("filter-date");
    const btnApply = document.getElementById("btn-apply-filters");
    const btnClear = document.getElementById("btn-clear-filters");
    const btnExport = document.getElementById("btn-export");
    const tbody = document.getElementById("records-tbody");
    const tableEmpty = document.getElementById("table-empty");
    const recordCount = document.getElementById("record-count");
    const toastContainer = document.getElementById("toast-container");

    const dashStatToday = document.getElementById("dash-stat-today");
    const dashStatTotal = document.getElementById("dash-stat-total");
    const dashStatRate = document.getElementById("dash-stat-rate");
    const dashStatDepts = document.getElementById("dash-stat-depts");

    function init() {
        const today = new Date().toISOString().split("T")[0];
        filterDate.value = today;

        loadStats();
        loadDepartments();
        fetchRecords();
        bindEvents();
    }

    function bindEvents() {
        btnApply.addEventListener("click", fetchRecords);
        btnClear.addEventListener("click", clearFilters);
        btnExport.addEventListener("click", exportRecords);

        filterReg.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                fetchRecords();
            }
        });

        filterDept.addEventListener("change", fetchRecords);
        filterDate.addEventListener("change", fetchRecords);
    }

    async function loadStats() {
        try {
            const res = await fetch("/api/stats");
            const data = await res.json();

            const totalToday = data.total_today || 0;
            const totalStudents = data.total_students || 0;
            const deptCounts = data.department_counts || {};

            dashStatToday.textContent = totalToday;
            dashStatTotal.textContent = totalStudents;
            dashStatDepts.textContent = Object.keys(deptCounts).length;

            if (totalStudents > 0) {
                dashStatRate.textContent = Math.round((totalToday / totalStudents) * 100) + "%";
            } else {
                dashStatRate.textContent = "0%";
            }
        } catch (err) {
            console.error("Failed to load stats:", err);
        }
    }

    async function loadDepartments() {
        try {
            const res = await fetch("/api/attendance?date=__none__");
            const data = await res.json();
            const departments = data.departments || [];

            filterDept.innerHTML = '<option value="">All Departments</option>';
            departments.forEach((dept) => {
                const opt = document.createElement("option");
                opt.value = dept;
                opt.textContent = dept;
                filterDept.appendChild(opt);
            });
        } catch (err) {
            console.error("Failed to load departments:", err);
        }
    }

    async function fetchRecords() {
        const params = new URLSearchParams();
        if (filterDate.value) params.set("date", filterDate.value);
        if (filterDept.value) params.set("department", filterDept.value);
        if (filterReg.value.trim()) params.set("reg_no", filterReg.value.trim());

        try {
            const res = await fetch(`/api/attendance?${params.toString()}`);
            const data = await res.json();
            renderTable(data.records || []);
        } catch (err) {
            console.error("Fetch error:", err);
            showToast("Failed to load records.", "error");
        }
    }

    function renderTable(records) {
        tbody.innerHTML = "";

        if (records.length === 0) {
            tableEmpty.style.display = "flex";
            recordCount.textContent = "Showing 0 records";
            return;
        }

        tableEmpty.style.display = "none";
        recordCount.textContent = `Showing ${records.length} record${records.length > 1 ? "s" : ""}`;

        records.forEach((record, index) => {
            const tr = document.createElement("tr");
            tr.style.animation = `fadeInUp 0.3s ease ${index * 0.03}s both`;
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${escapeHtml(record["Date"] || "-")}</td>
                <td>${escapeHtml(record["Time"] || "-")}</td>
                <td><strong>${escapeHtml(record["Register Number"] || "-")}</strong></td>
                <td>${escapeHtml(record["Name"] || "-")}</td>
                <td><span class="badge badge-dept">${escapeHtml(record["Department"] || "-")}</span></td>
                <td>${escapeHtml(record["Class"] || "-")}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function clearFilters() {
        filterReg.value = "";
        filterDept.value = "";
        filterDate.value = "";
        fetchRecords();
    }

    function exportRecords() {
        const params = new URLSearchParams();
        if (filterDate.value) params.set("date", filterDate.value);
        if (filterDept.value) params.set("department", filterDept.value);
        if (filterReg.value.trim()) params.set("reg_no", filterReg.value.trim());

        window.location.href = `/api/export?${params.toString()}`;
        showToast("Exporting attendance records...", "success");
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function showToast(message, type = "success") {
        const icons = {
            success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
            error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
            warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        };

        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            ${icons[type] || icons.success}
            <span>${escapeHtml(message)}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;

        toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add("fade-out");
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    document.addEventListener("DOMContentLoaded", init);
})();
