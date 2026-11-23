param(
  [string]$Mode = 'get',
  [int]$Speed = 0
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 鼠标速度通过 user32 的 SystemParametersInfo 读写
$pointerCode = @'
using System;
using System.Runtime.InteropServices;

namespace DevicePointer
{
    public static class MouseSpeedNative
    {
        private const uint SpiGetMouseSpeed = 0x0070;
        private const uint SpiSetMouseSpeed = 0x0071;
        private const uint SpifUpdateIniFile = 0x01;
        private const uint SpifSendChange = 0x02;
        private const int MinSpeed = 1;
        private const int MaxSpeed = 20;

        [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SystemParametersInfoGet(uint uiAction, uint uiParam, out int pvParam, uint fWinIni);

        [DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SystemParametersInfoSet(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

        private static int Clamp(int speed)
        {
            if (speed < MinSpeed)
            {
                return MinSpeed;
            }
            if (speed > MaxSpeed)
            {
                return MaxSpeed;
            }
            return speed;
        }

        public static int Get()
        {
            int speed;
            if (!SystemParametersInfoGet(SpiGetMouseSpeed, 0, out speed, 0))
            {
                throw new InvalidOperationException("读取鼠标速度失败");
            }
            return Clamp(speed);
        }

        public static int Set(int speed)
        {
            int safe = Clamp(speed);
            if (!SystemParametersInfoSet(SpiSetMouseSpeed, 0, new IntPtr(safe), SpifUpdateIniFile | SpifSendChange))
            {
                throw new InvalidOperationException("设置鼠标速度失败");
            }
            return Get();
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $pointerCode -Language CSharp -ErrorAction Stop
} catch {
  [Console]::Error.WriteLine('指针模块加载失败：' + $_.Exception.Message)
  exit 1
}

try {
  if ($Mode -eq 'get') {
    $speed = [DevicePointer.MouseSpeedNative]::Get()
    Write-Output (ConvertTo-Json -InputObject ([ordered]@{ speed = [int]$speed }) -Compress)
  } elseif ($Mode -eq 'set') {
    $speed = [DevicePointer.MouseSpeedNative]::Set([int]$Speed)
    Write-Output (ConvertTo-Json -InputObject ([ordered]@{ speed = [int]$speed }) -Compress)
  } else {
    [Console]::Error.WriteLine('未知模式：' + $Mode)
    exit 1
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
