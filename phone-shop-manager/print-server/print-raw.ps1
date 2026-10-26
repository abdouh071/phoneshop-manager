param(
    [string]$PrinterName,
    [string]$FilePath
)

# 1. Validation
if (-not $FilePath -or -not (Test-Path $FilePath)) {
    Write-Error "Print data file not found: '$FilePath'"
    exit 2
}

# 2. C# WinSpool P/Invoke code (Compatible with .NET 2.0+ and Windows 7+)
$code = @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrintHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static int SendBytesToPrinter(string printerName, byte[] bytes) {
        if (bytes == null || bytes.Length == 0) return -1;
        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
        Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);

        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "ThermalRawPrintJob";
        di.pDataType = "RAW";

        int result = -2; // failed open
        try {
            if (OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
                result = -3; // failed start doc
                if (StartDocPrinter(hPrinter, 1, di)) {
                    result = -4; // failed page
                    if (StartPagePrinter(hPrinter)) {
                        int dwWritten = 0;
                        bool bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                        EndPagePrinter(hPrinter);
                        if (bSuccess && dwWritten == bytes.Length) {
                            result = 0; // success!
                        } else {
                            result = -5; // write error
                        }
                    }
                    EndDocPrinter(hPrinter);
                }
                ClosePrinter(hPrinter);
            }
        } catch {
            result = -99;
        } finally {
            Marshal.FreeCoTaskMem(pUnmanagedBytes);
        }
        return result;
    }
}
'@

# 3. Load pre-compiled DLL from %TEMP% or compile once (cached in 10ms on subsequent prints)
$dllPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "PhoneShopRawPrint.dll")
if (-not ([System.Management.Automation.PSTypeName]'RawPrintHelper').Type) {
    if (Test-Path $dllPath) {
        try { [System.Reflection.Assembly]::LoadFrom($dllPath) | Out-Null } catch {}
    }
    if (-not ([System.Management.Automation.PSTypeName]'RawPrintHelper').Type) {
        try {
            Add-Type -TypeDefinition $code -OutputAssembly $dllPath -ErrorAction SilentlyContinue
        } catch {
            try { Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue } catch {}
        }
    }
}

$fileBytes = [System.IO.File]::ReadAllBytes($FilePath)

# 4. Attempt 1: Direct print to specified printer (instant, zero WMI overhead)
$targetUsed = $PrinterName
$res = -1
if ($targetUsed -and $targetUsed.Trim() -ne "") {
    $res = [RawPrintHelper]::SendBytesToPrinter($targetUsed, $fileBytes)
    if ($res -eq 0) {
        Write-Output "SUCCESS: Printed to '$targetUsed'"
        exit 0
    }
}

# 5. Fallback: Query installed printers ONLY if direct print failed or target was empty
$installedPrinters = @()
try {
    $installedPrinters = @(Get-WmiObject Win32_Printer | ForEach-Object { $_.Name })
} catch {}

$defaultPrinter = ""
try {
    $defaultPrinter = (Get-WmiObject Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1).Name
} catch {}

# Attempt 2: fuzzy match if specified name failed
if ($targetUsed -and $installedPrinters.Count -gt 0) {
    $cleanTarget = $targetUsed.Replace('_', '').Replace('-', '').Replace(' ', '').ToLower()
    $candidate = $installedPrinters | Where-Object {
        $c = $_.Replace('_', '').Replace('-', '').Replace(' ', '').ToLower()
        $c -eq $cleanTarget -or $c.Contains($cleanTarget) -or $cleanTarget.Contains($c)
    } | Select-Object -First 1

    if ($candidate) {
        $res = [RawPrintHelper]::SendBytesToPrinter($candidate, $fileBytes)
        if ($res -eq 0) {
            Write-Output "SUCCESS: Printed to '$candidate'"
            exit 0
        }
    }
}

# Attempt 3: fallback to default printer
if ($defaultPrinter -and $defaultPrinter -ne $targetUsed) {
    $res = [RawPrintHelper]::SendBytesToPrinter($defaultPrinter, $fileBytes)
    if ($res -eq 0) {
        Write-Output "SUCCESS: Printed to '$defaultPrinter'"
        exit 0
    }
}

# Error reporting
$errCodeMap = @{
    "-1" = "Empty print buffer";
    "-2" = "Could not open printer '$PrinterName' (Printer not found or driver issue)";
    "-3" = "StartDocPrinter failed (Check spooler service)";
    "-4" = "StartPagePrinter failed";
    "-5" = "WritePrinter failed";
    "-99" = "Internal exception in WinSpool API";
}
$errMsg = $errCodeMap["$res"]
if (-not $errMsg) { $errMsg = "Unknown spooler error (code $res)" }
$printerList = if ($installedPrinters.Count -gt 0) { $installedPrinters -join ', ' } else { "None detected" }
Write-Error "Windows Print Spooler Error: $errMsg. (Target was: '$PrinterName', Installed Windows printers: $printerList)"
exit 1
