/**
 * scanner.js - Barcode/RFID scanner logic.
 * Handles camera scanning, manual register-number lookup, and attendance submission.
 */

(function () {
    "use strict";

    const btnStartScanner = document.getElementById("btn-start-scanner");
    const btnStopScanner = document.getElementById("btn-stop-scanner");
    const manualInput = document.getElementById("manual-reg-input");
    const btnManualSearch = document.getElementById("btn-manual-search");
    const btnSubmit = document.getElementById("btn-submit-attendance");
    const studentCard = document.getElementById("student-card");
    const emptyState = document.getElementById("empty-state");
    const toastContainer = document.getElementById("toast-container");
    const readerElement = document.getElementById("reader");

    const elName = document.getElementById("student-name");
    const elReg = document.getElementById("student-reg");
    const elDept = document.getElementById("student-dept-badge");
    const elClass = document.getElementById("student-class");
    const elDate = document.getElementById("student-date");
    const elTime = document.getElementById("student-time");

    const statToday = document.getElementById("stat-today");
    const statTotal = document.getElementById("stat-total");

    const searchButtonIcon = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
    `;

    const submitButtonIcon = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
    `;

    const loadingIcon = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20" style="animation: pulse 1s infinite;">
            <circle cx="12" cy="12" r="10"></circle>
        </svg>
    `;

    let html5QrCode = null;
    let scannerRunning = false;
    let scannerEngine = "";
    let currentStudent = null;
    let currentLookupSource = "";
    let scanCooldown = false;
    let lookupPending = false;

    let nativeDetector = null;
    let nativeVideo = null;
    let nativeStream = null;
    let nativeScanFrame = 0;
    let nativeScanBusy = false;

    function init() {
        loadStats();
        bindEvents();
        updateManualSearchState();
        setSubmitButtonIdle();
    }

    function bindEvents() {
        btnStartScanner.addEventListener("click", startScanner);
        btnStopScanner.addEventListener("click", stopScanner);
        btnManualSearch.addEventListener("click", handleManualLookup);
        btnSubmit.addEventListener("click", submitAttendance);
        manualInput.addEventListener("input", onManualInputChange);
        manualInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                handleManualLookup();
            }
        });
    }

    async function loadStats() {
        try {
            const res = await fetch("/api/stats");
            const data = await res.json();
            statToday.textContent = data.total_today || 0;
            statTotal.textContent = data.total_students || 0;
        } catch (err) {
            console.error("Failed to load stats:", err);
        }
    }

    function onManualInputChange() {
        if (currentStudent && !matchesCurrentStudent(manualInput.value)) {
            hideStudentCard();
        }
        updateManualSearchState();
    }

    function matchesCurrentStudent(value) {
        const lookupValue = normalizeValue(value);
        if (!lookupValue || !currentStudent) {
            return false;
        }

        return [currentStudent.reg_no, currentStudent.barcode]
            .map(normalizeValue)
            .includes(lookupValue);
    }

    function normalizeValue(value) {
        return String(value || "").trim().toUpperCase();
    }

    function updateManualSearchState() {
        const hasValue = manualInput.value.trim().length > 0;
        btnManualSearch.disabled = !hasValue || lookupPending;
        btnManualSearch.innerHTML = `${searchButtonIcon}${lookupPending ? "Searching..." : "Find Student"}`;
    }

    function setSubmitButtonIdle() {
        btnSubmit.innerHTML = `${submitButtonIcon}Submit Attendance`;
    }

    function toggleScannerButtons(isRunning) {
        btnStartScanner.style.display = isRunning ? "none" : "inline-flex";
        btnStopScanner.style.display = isRunning ? "inline-flex" : "none";
    }

    async function startScanner() {
        if (scannerRunning) {
            return;
        }

        hideStudentCard();
        currentLookupSource = "";

        try {
            let started = await startNativeScanner();

            if (!started) {
                started = await startHtml5Scanner();
            }

            if (!started) {
                started = await startQuaggaScanner();
            }

            if (!started) {
                throw new Error("No scanner engine is available in this browser.");
            }

            scannerRunning = true;
            if (scannerEngine === "native") {
                nativeScanFrame = window.requestAnimationFrame(scanNativeFrame);
            }

            toggleScannerButtons(true);
            showToast("Camera started. Point the barcode at the camera.", "success");
        } catch (err) {
            console.error("Scanner error:", err);
            await cleanupScanner();
            showToast("Could not start camera. You can still search by register number.", "error");
        }
    }

    async function stopScanner() {
        await cleanupScanner();
        toggleScannerButtons(false);
    }

    async function cleanupScanner() {
        if (nativeScanFrame) {
            window.cancelAnimationFrame(nativeScanFrame);
            nativeScanFrame = 0;
        }

        nativeScanBusy = false;

        if (scannerEngine === "native") {
            if (nativeStream) {
                nativeStream.getTracks().forEach((track) => track.stop());
            }
            if (nativeVideo) {
                nativeVideo.pause();
                nativeVideo.srcObject = null;
            }
        } else if (scannerEngine === "html5" && html5QrCode) {
            try {
                await html5QrCode.stop();
                await html5QrCode.clear();
            } catch (err) {
                console.warn("Failed to stop html5-qrcode cleanly:", err);
            }
            html5QrCode = null;
        } else if (scannerEngine === "quagga" && typeof Quagga !== "undefined") {
            try {
                if (typeof Quagga.offDetected === "function") {
                    Quagga.offDetected(onQuaggaDetected);
                }
                Quagga.stop();
            } catch (err) {
                console.warn("Failed to stop Quagga cleanly:", err);
            }
        }

        nativeDetector = null;
        nativeVideo = null;
        nativeStream = null;
        readerElement.innerHTML = "";
        scannerRunning = false;
        scannerEngine = "";
    }

    async function startNativeScanner() {
        if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
            return false;
        }

        const preferredFormats = [
            "code_128",
            "code_39",
            "codabar",
            "ean_13",
            "ean_8",
            "upc_a",
            "upc_e",
            "itf",
            "qr_code",
        ];

        let formats = preferredFormats;
        if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
            const supportedFormats = await window.BarcodeDetector.getSupportedFormats();
            formats = preferredFormats.filter((format) => supportedFormats.includes(format));
            if (!formats.length) {
                return false;
            }
        }

        try {
            nativeDetector = new window.BarcodeDetector({ formats });
        } catch (err) {
            console.warn("Native barcode detector is unavailable:", err);
            return false;
        }

        nativeStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
            audio: false,
        });

        readerElement.innerHTML = "";
        nativeVideo = document.createElement("video");
        nativeVideo.className = "scanner-video";
        nativeVideo.setAttribute("playsinline", "true");
        nativeVideo.autoplay = true;
        nativeVideo.muted = true;
        nativeVideo.srcObject = nativeStream;
        readerElement.appendChild(nativeVideo);

        await nativeVideo.play();
        scannerEngine = "native";
        return true;
    }

    async function scanNativeFrame() {
        if (!scannerRunning || scannerEngine !== "native" || !nativeDetector || !nativeVideo) {
            return;
        }

        if (!nativeScanBusy && nativeVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            nativeScanBusy = true;
            try {
                const barcodes = await nativeDetector.detect(nativeVideo);
                if (Array.isArray(barcodes) && barcodes.length > 0) {
                    const detectedValue = barcodes.find((barcode) => barcode.rawValue)?.rawValue || "";
                    if (detectedValue) {
                        handleDetectedCode(detectedValue);
                    }
                }
            } catch (err) {
                console.warn("Native barcode detection failed:", err);
            } finally {
                nativeScanBusy = false;
            }
        }

        nativeScanFrame = window.requestAnimationFrame(scanNativeFrame);
    }

    async function startHtml5Scanner() {
        if (typeof Html5Qrcode === "undefined" || typeof Html5QrcodeSupportedFormats === "undefined") {
            return false;
        }

        readerElement.innerHTML = "";
        html5QrCode = new Html5Qrcode("reader");

        const config = {
            fps: 12,
            qrbox: { width: 380, height: 220 },
            aspectRatio: 1.333,
            disableFlip: false,
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true,
            },
            formatsToSupport: [
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.CODE_93,
                Html5QrcodeSupportedFormats.CODABAR,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.ITF,
                Html5QrcodeSupportedFormats.QR_CODE,
            ],
            videoConstraints: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
        };

        try {
            await html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, onScanFailure);
            scannerEngine = "html5";
            return true;
        } catch (err) {
            console.warn("html5-qrcode init failed:", err);
            html5QrCode = null;
            return false;
        }
    }

    function startQuaggaScanner() {
        if (typeof Quagga === "undefined" || typeof Quagga.init !== "function") {
            return Promise.resolve(false);
        }

        readerElement.innerHTML = "";

        return new Promise((resolve) => {
            Quagga.init({
                inputStream: {
                    type: "LiveStream",
                    target: readerElement,
                    constraints: {
                        facingMode: "environment",
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                    },
                    area: {
                        top: "10%",
                        right: "5%",
                        left: "5%",
                        bottom: "10%",
                    },
                },
                locator: {
                    patchSize: "large",
                    halfSample: false,
                },
                numOfWorkers: 0,
                locate: true,
                frequency: 10,
                decoder: {
                    readers: [
                        "code_128_reader",
                        "code_39_reader",
                        "codabar_reader",
                        "ean_reader",
                        "ean_8_reader",
                        "upc_reader",
                        "upc_e_reader",
                        "i2of5_reader",
                    ],
                    multiple: false,
                },
            }, (err) => {
                if (err) {
                    console.warn("Quagga init failed:", err);
                    resolve(false);
                    return;
                }

                if (typeof Quagga.offDetected === "function") {
                    Quagga.offDetected(onQuaggaDetected);
                }
                Quagga.onDetected(onQuaggaDetected);
                Quagga.start();
                scannerEngine = "quagga";
                resolve(true);
            });
        });
    }

    function onScanSuccess(decodedText) {
        handleDetectedCode(decodedText);
    }

    function onQuaggaDetected(result) {
        handleDetectedCode(result?.codeResult?.code || "");
    }

    function onScanFailure() {
        // Ignore frame-level misses while the camera is scanning.
    }

    function handleDetectedCode(decodedText) {
        if (scanCooldown) {
            return;
        }

        const regNo = String(decodedText || "").trim();
        if (!regNo) {
            return;
        }

        scanCooldown = true;
        window.setTimeout(() => {
            scanCooldown = false;
        }, 2500);

        manualInput.value = regNo;
        updateManualSearchState();
        showToast(`Scanned: ${regNo}`, "success");
        lookupStudent(regNo, "scan");
    }

    async function handleManualLookup() {
        const regNo = manualInput.value.trim();
        if (!regNo || lookupPending) {
            return;
        }

        if (currentStudent && matchesCurrentStudent(regNo)) {
            return;
        }

        hideStudentCard();
        await lookupStudent(regNo, "manual");
    }

    async function lookupStudent(regNo, source) {
        lookupPending = true;
        updateManualSearchState();

        try {
            const res = await fetch(`/api/student/${encodeURIComponent(regNo)}`);
            const data = await res.json();

            if (!res.ok) {
                currentLookupSource = "";
                hideStudentCard();
                showToast(data.error || "Student not found", "error");
                return;
            }

            currentStudent = data;
            currentLookupSource = source;
            displayStudent(data);
        } catch (err) {
            console.error("Lookup error:", err);
            currentLookupSource = "";
            hideStudentCard();
            showToast("Network error. Please try again.", "error");
        } finally {
            lookupPending = false;
            updateManualSearchState();
        }
    }

    function displayStudent(student) {
        const now = new Date();

        elName.textContent = student.name;
        elReg.textContent = student.reg_no;
        elDept.textContent = student.department || student.class || "Student";
        elClass.textContent = student.class;
        elDate.textContent = now.toLocaleDateString("en-IN", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
        });
        elTime.textContent = now.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        });

        emptyState.style.display = "none";
        studentCard.style.display = "block";
        studentCard.style.animation = "none";
        studentCard.offsetHeight;
        studentCard.style.animation = "fadeInUp 0.4s ease";
    }

    function hideStudentCard() {
        emptyState.style.display = "flex";
        studentCard.style.display = "none";
        currentStudent = null;
        currentLookupSource = "";
    }

    async function submitAttendance() {
        if (!currentStudent) {
            showToast("Search or scan a student first.", "warning");
            return;
        }

        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `${loadingIcon}Saving...`;

        try {
            const res = await fetch("/api/attendance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reg_no: currentStudent.reg_no,
                    name: currentStudent.name,
                    department: currentStudent.department,
                    class: currentStudent.class,
                }),
            });

            const data = await res.json();

            if (res.status === 409) {
                showToast(data.error || "Attendance already recorded today.", "warning");
            } else if (!res.ok) {
                showToast(data.error || "Failed to save attendance.", "error");
            } else {
                showToast(data.message || "Attendance recorded successfully!", "success");
                manualInput.value = "";
                hideStudentCard();
                updateManualSearchState();
                loadStats();
            }
        } catch (err) {
            console.error("Submit error:", err);
            showToast("Network error. Could not save attendance.", "error");
        } finally {
            btnSubmit.disabled = false;
            setSubmitButtonIdle();
        }
    }

    function showToast(message, type = "success") {
        const icons = {
            success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
            error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
            warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
        };

        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            ${icons[type] || icons.success}
            <span>${escapeHtml(message)}</span>
            <button class="toast-close" type="button" onclick="this.parentElement.remove()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        `;

        toastContainer.appendChild(toast);

        window.setTimeout(() => {
            toast.classList.add("fade-out");
            window.setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    document.addEventListener("DOMContentLoaded", init);
})();
