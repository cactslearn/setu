# Setu Companion - Windows Native Input Driver
# Persistent stdin process using Win32 user32.dll

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinDriver {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
}
"@

$w = [WinDriver]::GetSystemMetrics(0)
$h = [WinDriver]::GetSystemMetrics(1)
[Console]::WriteLine("READY $w $h")

while ($line = [Console]::ReadLine()) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line.Split(' ')
    $cmd = $parts[0]
    
    switch ($cmd) {
        "M" {
            # Mouse Move: M x y
            [WinDriver]::SetCursorPos([int]$parts[1], [int]$parts[2]) | Out-Null
        }
        "D" {
            # Mouse Down: D flags (2 = Left, 8 = Right, 32 = Middle)
            [WinDriver]::mouse_event([uint32]$parts[1], 0, 0, 0, 0)
        }
        "U" {
            # Mouse Up: U flags (4 = Left, 16 = Right, 64 = Middle)
            [WinDriver]::mouse_event([uint32]$parts[1], 0, 0, 0, 0)
        }
        "W" {
            # Mouse Wheel: W amount
            [WinDriver]::mouse_event(0x0800, 0, 0, [uint32][int]$parts[1], 0)
        }
        "K" {
            # Keybd Event: K vk flags (0 = down, 2 = up)
            [WinDriver]::keybd_event([byte]$parts[1], 0, [uint32]$parts[2], 0)
        }
        "Q" {
            exit 0
        }
    }
}
