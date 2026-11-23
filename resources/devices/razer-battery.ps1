param(
  [ValidateSet('list', 'query', 'probe')]
  [string]$Mode = 'query'
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 雷蛇私有 HID 协议：90 字节 Razer 帧，Windows 端 feature report 需带 Report ID 前缀。
# 这里枚举 VID 0x1532 的 HID 接口，按多种打开方式与发送策略只读探测电量。
$hidCode = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace RazerHid
{
    public class RazerInterfaceInfo
    {
        public string InstanceId;
        public string Path;
        public int VendorId;
        public int ProductId;
        public int UsagePage;
        public int Usage;
        public int FeatureReportLength;
        public int InputReportLength;
        public int OutputReportLength;
        public string Product;
        public string Manufacturer;
    }

    public class OpenModeResult
    {
        public string Mode;
        public bool Ok;
        public int Win32Error;
    }

    public class HidTransferResult
    {
        public bool Ok;
        public string Stage;
        public int Win32Error;
        public string ResponseHex;
    }

    public static class Hid
    {
        private const uint DIGCF_PRESENT = 0x02;
        private const uint DIGCF_DEVICEINTERFACE = 0x10;
        private const uint FILE_SHARE_READ = 0x01;
        private const uint FILE_SHARE_WRITE = 0x02;
        private const uint OPEN_EXISTING = 3;
        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential)]
        private struct SP_DEVICE_INTERFACE_DATA
        {
            public int cbSize;
            public Guid InterfaceClassGuid;
            public int Flags;
            public IntPtr Reserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HIDD_ATTRIBUTES
        {
            public int Size;
            public ushort VendorID;
            public ushort ProductID;
            public ushort VersionNumber;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HIDP_CAPS
        {
            public ushort Usage;
            public ushort UsagePage;
            public ushort InputReportByteLength;
            public ushort OutputReportByteLength;
            public ushort FeatureReportByteLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)]
            public ushort[] Reserved;
            public ushort NumberLinkCollectionNodes;
            public ushort NumberInputButtonCaps;
            public ushort NumberInputValueCaps;
            public ushort NumberInputDataIndices;
            public ushort NumberOutputButtonCaps;
            public ushort NumberOutputValueCaps;
            public ushort NumberOutputDataIndices;
            public ushort NumberFeatureButtonCaps;
            public ushort NumberFeatureValueCaps;
            public ushort NumberFeatureDataIndices;
        }

        private class ReadState
        {
            public bool Ok;
            public int Bytes;
            public int Error;
        }

        [DllImport("hid.dll")]
        private static extern void HidD_GetHidGuid(out Guid guid);

        [DllImport("hid.dll", SetLastError = true)]
        private static extern bool HidD_GetAttributes(IntPtr handle, ref HIDD_ATTRIBUTES attributes);

        [DllImport("hid.dll", SetLastError = true)]
        private static extern bool HidD_GetPreparsedData(IntPtr handle, out IntPtr preparsedData);

        [DllImport("hid.dll")]
        private static extern bool HidD_FreePreparsedData(IntPtr preparsedData);

        [DllImport("hid.dll")]
        private static extern int HidP_GetCaps(IntPtr preparsedData, ref HIDP_CAPS caps);

        [DllImport("hid.dll", CharSet = CharSet.Unicode)]
        private static extern bool HidD_GetProductString(IntPtr handle, StringBuilder buffer, int bufferLength);

        [DllImport("hid.dll", CharSet = CharSet.Unicode)]
        private static extern bool HidD_GetManufacturerString(IntPtr handle, StringBuilder buffer, int bufferLength);

        [DllImport("hid.dll", SetLastError = true)]
        private static extern bool HidD_SetFeature(IntPtr handle, byte[] buffer, int bufferLength);

        [DllImport("hid.dll", SetLastError = true)]
        private static extern bool HidD_GetFeature(IntPtr handle, byte[] buffer, int bufferLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool WriteFile(IntPtr handle, byte[] buffer, int bytesToWrite, out int bytesWritten, IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool ReadFile(IntPtr handle, byte[] buffer, int bytesToRead, out int bytesRead, IntPtr overlapped);

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, IntPtr enumerator, IntPtr hwndParent, uint flags);

        [DllImport("setupapi.dll")]
        private static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);

        [DllImport("setupapi.dll")]
        private static extern bool SetupDiEnumDeviceInterfaces(IntPtr deviceInfoSet, IntPtr deviceInfoData, ref Guid interfaceClassGuid, int memberIndex, ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData);

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode)]
        private static extern bool SetupDiGetDeviceInterfaceDetailW(IntPtr deviceInfoSet, ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData, IntPtr deviceInterfaceDetailData, int deviceInterfaceDetailDataSize, out int requiredSize, IntPtr deviceInfoData);

        [DllImport("setupapi.dll", CharSet = CharSet.Unicode)]
        private static extern bool SetupDiGetDeviceInstanceIdW(IntPtr deviceInfoSet, ref SP_DEVICE_INTERFACE_DATA deviceInterfaceData, StringBuilder deviceInstanceId, int deviceInstanceIdSize, out int requiredSize);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFileW(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        private static uint AccessFor(string mode)
        {
            if (mode == "read")
            {
                return GENERIC_READ;
            }
            if (mode == "write")
            {
                return GENERIC_WRITE;
            }
            if (mode == "none")
            {
                return 0;
            }
            return GENERIC_READ | GENERIC_WRITE;
        }

        public static RazerInterfaceInfo[] ListInterfaces()
        {
            List<RazerInterfaceInfo> result = new List<RazerInterfaceInfo>();
            Guid hidGuid;
            HidD_GetHidGuid(out hidGuid);
            IntPtr deviceInfoSet = SetupDiGetClassDevs(ref hidGuid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
            if (deviceInfoSet == INVALID_HANDLE_VALUE)
            {
                return result.ToArray();
            }
            try
            {
                SP_DEVICE_INTERFACE_DATA data = new SP_DEVICE_INTERFACE_DATA();
                data.cbSize = Marshal.SizeOf(typeof(SP_DEVICE_INTERFACE_DATA));
                int index = 0;
                while (SetupDiEnumDeviceInterfaces(deviceInfoSet, IntPtr.Zero, ref hidGuid, index, ref data))
                {
                    index++;
                    int requiredSize = 0;
                    SetupDiGetDeviceInterfaceDetailW(deviceInfoSet, ref data, IntPtr.Zero, 0, out requiredSize, IntPtr.Zero);
                    if (requiredSize <= 0)
                    {
                        continue;
                    }
                    IntPtr detail = Marshal.AllocHGlobal(requiredSize);
                    try
                    {
                        // cbSize：64 位为 8，32 位为 6（4 字节长度 + 2 字节 WCHAR 对齐）
                        Marshal.WriteInt32(detail, 0, IntPtr.Size == 8 ? 8 : 6);
                        if (!SetupDiGetDeviceInterfaceDetailW(deviceInfoSet, ref data, detail, requiredSize, out requiredSize, IntPtr.Zero))
                        {
                            continue;
                        }
                        string path = Marshal.PtrToStringUni(new IntPtr(detail.ToInt64() + 4));
                        if (string.IsNullOrEmpty(path))
                        {
                            continue;
                        }
                        IntPtr handle = CreateFileW(path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
                        if (handle == INVALID_HANDLE_VALUE)
                        {
                            continue;
                        }
                        try
                        {
                            HIDD_ATTRIBUTES attributes = new HIDD_ATTRIBUTES();
                            attributes.Size = Marshal.SizeOf(typeof(HIDD_ATTRIBUTES));
                            if (!HidD_GetAttributes(handle, ref attributes))
                            {
                                continue;
                            }
                            if (attributes.VendorID != 0x1532)
                            {
                                continue;
                            }
                            RazerInterfaceInfo info = new RazerInterfaceInfo();
                            info.Path = path;
                            info.VendorId = attributes.VendorID;
                            info.ProductId = attributes.ProductID;
                            info.InstanceId = GetInstanceId(deviceInfoSet, ref data);
                            if (string.IsNullOrEmpty(info.InstanceId))
                            {
                                info.InstanceId = InstanceIdFromPath(path);
                            }
                            IntPtr preparsedData;
                            if (HidD_GetPreparsedData(handle, out preparsedData))
                            {
                                try
                                {
                                    HIDP_CAPS caps = new HIDP_CAPS();
                                    HidP_GetCaps(preparsedData, ref caps);
                                    info.Usage = caps.Usage;
                                    info.UsagePage = caps.UsagePage;
                                    info.FeatureReportLength = caps.FeatureReportByteLength;
                                    info.InputReportLength = caps.InputReportByteLength;
                                    info.OutputReportLength = caps.OutputReportByteLength;
                                }
                                finally
                                {
                                    HidD_FreePreparsedData(preparsedData);
                                }
                            }
                            StringBuilder product = new StringBuilder(256);
                            if (HidD_GetProductString(handle, product, product.Capacity * 2))
                            {
                                info.Product = product.ToString();
                            }
                            StringBuilder manufacturer = new StringBuilder(256);
                            if (HidD_GetManufacturerString(handle, manufacturer, manufacturer.Capacity * 2))
                            {
                                info.Manufacturer = manufacturer.ToString();
                            }
                            result.Add(info);
                        }
                        finally
                        {
                            CloseHandle(handle);
                        }
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(detail);
                    }
                }
            }
            finally
            {
                SetupDiDestroyDeviceInfoList(deviceInfoSet);
            }
            return result.ToArray();
        }

        private static string GetInstanceId(IntPtr deviceInfoSet, ref SP_DEVICE_INTERFACE_DATA data)
        {
            StringBuilder buffer = new StringBuilder(1024);
            int requiredSize = 0;
            if (!SetupDiGetDeviceInstanceIdW(deviceInfoSet, ref data, buffer, buffer.Capacity, out requiredSize))
            {
                return "";
            }
            return buffer.ToString();
        }

        // 兜底：从接口路径解析实例 ID
        // \\?\hid#vid_1532&pid_007b&mi_01&col02#7&2b4e52d9&0&0001#{guid}
        // -> HID\VID_1532&PID_007B&MI_01&COL02\7&2B4E52D9&0&0001
        private static string InstanceIdFromPath(string path)
        {
            string[] parts = path.Split('#');
            if (parts.Length < 3)
            {
                return "";
            }
            return "HID\\" + parts[1].ToUpperInvariant() + "\\" + parts[2].ToUpperInvariant();
        }

        private static string ToHex(byte[] bytes, int length)
        {
            StringBuilder hex = new StringBuilder(length * 2);
            for (int i = 0; i < length; i++)
            {
                hex.Append(bytes[i].ToString("X2"));
            }
            return hex.ToString();
        }

        private static void ReadHid(IntPtr handle, byte[] buffer, int size, ReadState state)
        {
            int read = 0;
            if (ReadFile(handle, buffer, size, out read, IntPtr.Zero))
            {
                state.Ok = true;
                state.Bytes = read;
            }
            else
            {
                state.Error = Marshal.GetLastWin32Error();
            }
        }

        // 依次尝试四种访问方式，记录每种方式的成败与 Win32 错误码
        public static OpenModeResult[] ProbeOpen(string path)
        {
            string[] modes = new string[] { "write", "readwrite", "none", "read" };
            List<OpenModeResult> results = new List<OpenModeResult>();
            foreach (string mode in modes)
            {
                OpenModeResult item = new OpenModeResult();
                item.Mode = mode;
                IntPtr handle = CreateFileW(path, AccessFor(mode), FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
                if (handle == INVALID_HANDLE_VALUE)
                {
                    item.Ok = false;
                    item.Win32Error = Marshal.GetLastWin32Error();
                }
                else
                {
                    item.Ok = true;
                    item.Win32Error = 0;
                    CloseHandle(handle);
                }
                results.Add(item);
            }
            return results.ToArray();
        }

        // 不发送请求，直接读取 feature report（部分设备会缓存电量）
        public static HidTransferResult GetFeatureOnly(string path, int length, string accessMode)
        {
            HidTransferResult result = new HidTransferResult();
            result.ResponseHex = "";
            IntPtr handle = CreateFileW(path, AccessFor(accessMode), FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
            if (handle == INVALID_HANDLE_VALUE)
            {
                result.Stage = "open";
                result.Win32Error = Marshal.GetLastWin32Error();
                return result;
            }
            try
            {
                byte[] response = new byte[length];
                if (!HidD_GetFeature(handle, response, length))
                {
                    result.Stage = "getfeature";
                    result.Win32Error = Marshal.GetLastWin32Error();
                    return result;
                }
                result.Ok = true;
                result.Stage = "getfeature";
                result.ResponseHex = ToHex(response, length);
                return result;
            }
            finally
            {
                CloseHandle(handle);
            }
        }

        // 统一传输：feature report 或 output+input report，返回阶段与 Win32 错误码
        public static HidTransferResult Transfer(string path, byte[] request, int length, bool useWrite, int readLength, string accessMode)
        {
            HidTransferResult result = new HidTransferResult();
            result.ResponseHex = "";
            IntPtr handle = CreateFileW(path, AccessFor(accessMode), FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
            if (handle == INVALID_HANDLE_VALUE)
            {
                result.Stage = "open";
                result.Win32Error = Marshal.GetLastWin32Error();
                return result;
            }
            try
            {
                int size = length > request.Length ? length : request.Length;
                byte[] buffer = new byte[size];
                Array.Copy(request, buffer, request.Length);
                if (!useWrite)
                {
                    if (!HidD_SetFeature(handle, buffer, size))
                    {
                        result.Stage = "setfeature";
                        result.Win32Error = Marshal.GetLastWin32Error();
                        return result;
                    }
                    Thread.Sleep(100);
                    byte[] response = new byte[size];
                    if (!HidD_GetFeature(handle, response, size))
                    {
                        result.Stage = "getfeature";
                        result.Win32Error = Marshal.GetLastWin32Error();
                        return result;
                    }
                    result.Ok = true;
                    result.Stage = "getfeature";
                    result.ResponseHex = ToHex(response, size);
                    return result;
                }
                int written = 0;
                if (!WriteFile(handle, buffer, size, out written, IntPtr.Zero))
                {
                    result.Stage = "writefile";
                    result.Win32Error = Marshal.GetLastWin32Error();
                    return result;
                }
                int readSize = readLength > 0 ? readLength : 90;
                byte[] input = new byte[readSize];
                ReadState state = new ReadState();
                Thread worker = new Thread(delegate() { ReadHid(handle, input, readSize, state); });
                worker.IsBackground = true;
                worker.Start();
                if (!worker.Join(300))
                {
                    // 121 = ERROR_SEM_TIMEOUT，读取阻塞时直接跳过
                    result.Stage = "readfile";
                    result.Win32Error = 121;
                    return result;
                }
                if (!state.Ok || state.Bytes <= 0)
                {
                    result.Stage = "readfile";
                    result.Win32Error = state.Error;
                    return result;
                }
                result.Ok = true;
                result.Stage = "readfile";
                result.ResponseHex = ToHex(input, state.Bytes);
                return result;
            }
            finally
            {
                CloseHandle(handle);
            }
        }
    }
}
'@

$interfaces = @()
try {
  Add-Type -TypeDefinition $hidCode -Language CSharp -ErrorAction Stop
  $interfaces = @([RazerHid.Hid]::ListInterfaces())
} catch {
  $interfaces = @()
}

# 无雷蛇设备时立即返回空数组
if ($interfaces.Count -eq 0) {
  ConvertTo-Json -InputObject @() -Depth 8 -Compress
  exit 0
}

# 容器 id 从注册表实例键读取（接收器多个 HID 集合共用同一容器）
function Get-ContainerId {
  param([string]$InstanceId)
  if ([string]::IsNullOrWhiteSpace($InstanceId)) {
    return $null
  }
  try {
    $values = Get-ItemProperty -LiteralPath ('HKLM:\SYSTEM\CurrentControlSet\Enum\' + $InstanceId) -Name ContainerID -ErrorAction SilentlyContinue
    if ($null -ne $values.ContainerID) {
      $text = ([string]$values.ContainerID).Trim()
      if ($text -ne '') {
        return $text
      }
    }
  } catch {
    return $null
  }
  return $null
}

# 构造 90 字节请求帧：crc = 字节 2–87 的 XOR
function New-RazerFrame {
  param(
    [int]$TransactionId,
    [int]$DataSize,
    [int]$CommandClass,
    [int]$CommandId,
    [int]$ProtocolType = 0,
    [int[]]$Arguments = @(0, 0)
  )
  $frame = New-Object byte[] 90
  $frame[0] = 0
  $frame[1] = [byte]($TransactionId -band 0xFF)
  $frame[2] = 0
  $frame[3] = 0
  $frame[4] = [byte]($ProtocolType -band 0xFF)
  $frame[5] = [byte]($DataSize -band 0xFF)
  $frame[6] = [byte]($CommandClass -band 0xFF)
  $frame[7] = [byte]($CommandId -band 0xFF)
  for ($i = 0; $i -lt $Arguments.Count -and (8 + $i) -lt 88; $i++) {
    $frame[8 + $i] = [byte]($Arguments[$i] -band 0xFF)
  }
  $crc = 0
  for ($i = 2; $i -lt 88; $i++) {
    $crc = $crc -bxor $frame[$i]
  }
  $frame[88] = [byte]($crc -band 0xFF)
  $frame[89] = 0
  return ,$frame
}

function Get-PreferredMode {
  param($OpenModes, [string[]]$Preferred)
  foreach ($name in $Preferred) {
    foreach ($entry in $OpenModes) {
      if ($entry.ok -and $entry.mode -eq $name) {
        return $name
      }
    }
  }
  return $null
}

$script:razerTransaction = 0

# 按策略下发一次请求。策略：
#   feature-id0 / feature-id2：FeatureReportByteLength 缓冲区，首字节为 Report ID
#   feature-noid：90 字节无前缀
#   getfeature-only：不发送，直接读取 feature report
#   write-id0：0x00 + 90 字节，WriteFile 发送后 ReadFile 读取
function Invoke-RazerStrategy {
  param(
    $Interface,
    $Command,
    [string]$Strategy,
    [int]$ReportId,
    [string]$TransferMode,
    [string]$AccessMode,
    [string]$WriteMode
  )
  $frame = New-RazerFrame -TransactionId $script:razerTransaction -DataSize $Command.size -CommandClass $Command.class -CommandId $Command.id -ProtocolType $Command.protocol
  $path = [string]$Interface.Path
  $result = $null
  if ($TransferMode -eq 'write') {
    $length = [int]$Interface.OutputReportLength
    if ($length -lt 91) {
      $length = 91
    }
    $buffer = New-Object byte[] $length
    $buffer[0] = [byte]$ReportId
    [Array]::Copy($frame, 0, $buffer, 1, [Math]::Min(90, $length - 1))
    $readLength = [int]$Interface.InputReportLength
    if ($readLength -lt 90) {
      $readLength = 90
    }
    try {
      $result = [RazerHid.Hid]::Transfer($path, $buffer, $length, $true, $readLength, $WriteMode)
    } catch {
      $result = $null
    }
  } elseif ($TransferMode -eq 'getfeature') {
    $length = [int]$Interface.FeatureReportLength
    if ($length -le 0) {
      $length = 91
    }
    try {
      $result = [RazerHid.Hid]::GetFeatureOnly($path, $length, $AccessMode)
    } catch {
      $result = $null
    }
  } elseif ($Strategy -eq 'feature-noid') {
    try {
      $result = [RazerHid.Hid]::Transfer($path, $frame, 90, $false, 90, $AccessMode)
    } catch {
      $result = $null
    }
  } else {
    $length = [int]$Interface.FeatureReportLength
    if ($length -le 0) {
      $length = 91
    }
    $buffer = New-Object byte[] $length
    $buffer[0] = [byte]$ReportId
    [Array]::Copy($frame, 0, $buffer, 1, [Math]::Min(90, $length - 1))
    try {
      $result = [RazerHid.Hid]::Transfer($path, $buffer, $length, $false, $length, $AccessMode)
    } catch {
      $result = $null
    }
  }

  $responseHex = ''
  $stage = 'transfer'
  $win32Error = 0
  if ($null -ne $result) {
    $responseHex = [string]$result.ResponseHex
    $stage = [string]$result.Stage
    $win32Error = [int]$result.Win32Error
  }
  $status = $null
  if ($responseHex.Length -ge 2) {
    try {
      $status = [Convert]::ToByte($responseHex.Substring(0, 2), 16)
    } catch {
      $status = $null
    }
  }
  $ok = ($null -ne $status -and $status -eq 0x02)
  $errorText = $null
  if (-not $ok) {
    if ($null -eq $status) {
      if ($win32Error -eq 0) {
        $errorText = '设备未响应'
      } else {
        $errorText = ('Win32 错误 {0}' -f $win32Error)
      }
    } else {
      $errorText = ('状态码 0x{0:X2}' -f $status)
    }
  }
  return ,([ordered]@{
    commandClass = $Command.class
    commandId = $Command.id
    protocolType = $Command.protocol
    strategy = $Strategy
    stage = $stage
    ok = $ok
    win32Error = $win32Error
    responseHex = $responseHex
    error = $errorText
  })
}

# 依次尝试策略，拿到可解析状态码即停止该命令的后续策略
function Invoke-RazerCommand {
  param($Interface, $Command, [string]$AccessMode, [string]$WriteMode)
  $strategies = @(
    @{ name = 'feature-id0'; reportId = 0x00; mode = 'feature' },
    @{ name = 'feature-id2'; reportId = 0x02; mode = 'feature' },
    @{ name = 'feature-noid'; reportId = 0x00; mode = 'noid' },
    @{ name = 'getfeature-only'; reportId = 0x00; mode = 'getfeature' },
    @{ name = 'write-id0'; reportId = 0x00; mode = 'write' }
  )
  $records = New-Object System.Collections.ArrayList
  foreach ($strategy in $strategies) {
    if ([DateTime]::UtcNow -gt $script:razerDeadline) {
      break
    }
    $record = Invoke-RazerStrategy -Interface $Interface -Command $Command -Strategy $strategy.name -ReportId $strategy.reportId -TransferMode $strategy.mode -AccessMode $AccessMode -WriteMode $WriteMode
    [void]$records.Add($record)
    $text = [string]$record.responseHex
    if ($text.Length -ge 2 -and $text -match '^[0-9A-Fa-f]{2}') {
      break
    }
  }
  return ,$records
}

# 执行一轮完整命令矩阵（含 protocol 0x02 重试），返回记录与是否成功
function Invoke-RazerMatrix {
  param($Interface, [string]$AccessMode, [string]$WriteMode)
  $records = New-Object System.Collections.ArrayList
  $anyOk = $false
  foreach ($command in $matrix) {
    if ([DateTime]::UtcNow -gt $script:razerDeadline) {
      break
    }
    $batch = Invoke-RazerCommand -Interface $Interface -Command $command -AccessMode $AccessMode -WriteMode $WriteMode
    foreach ($record in $batch) {
      [void]$records.Add($record)
      if ($record.ok) {
        $anyOk = $true
      }
    }
  }
  if (-not $anyOk -and [DateTime]::UtcNow -le $script:razerDeadline) {
    # 前三条均失败时，用 protocol 0x02 重试前两条命令
    foreach ($command in @($matrix[0], $matrix[1])) {
      if ([DateTime]::UtcNow -gt $script:razerDeadline) {
        break
      }
      $retry = @{ class = $command.class; id = $command.id; protocol = 0x02; size = $command.size }
      $batch = Invoke-RazerCommand -Interface $Interface -Command $retry -AccessMode $AccessMode -WriteMode $WriteMode
      foreach ($record in $batch) {
        [void]$records.Add($record)
      }
    }
  }
  return ,([ordered]@{ records = @($records); anyOk = $anyOk })
}

$baseItems = New-Object System.Collections.ArrayList
$baseByPath = @{}
foreach ($interface in $interfaces) {
  $instanceId = [string]$interface.InstanceId
  $item = [ordered]@{
    instanceId = $instanceId
    path = [string]$interface.Path
    containerId = (Get-ContainerId $instanceId)
    vendorId = [int]$interface.VendorId
    productId = [int]$interface.ProductId
    usagePage = [int]$interface.UsagePage
    usage = [int]$interface.Usage
    product = [string]$interface.Product
    featureReportLength = [int]$interface.FeatureReportLength
    inputReportLength = [int]$interface.InputReportLength
    outputReportLength = [int]$interface.OutputReportLength
  }
  [void]$baseItems.Add($item)
  $baseByPath[[string]$interface.Path] = $item
}

if ($Mode -eq 'list') {
  foreach ($item in $baseItems) {
    $item.openMode = 'readwrite'
  }
  ConvertTo-Json -InputObject @($baseItems) -Depth 8 -Compress
  exit 0
}

# 命令矩阵：class 0x07/0x80、0x07/0x00、0x3F/0x80
$matrix = @(
  @{ class = 0x07; id = 0x80; protocol = 0x00; size = 0x02 },
  @{ class = 0x07; id = 0x00; protocol = 0x00; size = 0x02 },
  @{ class = 0x3F; id = 0x80; protocol = 0x00; size = 0x02 }
)

# 可发送的接口优先；featureReportLength 为 0 的接口直接跳过发送
$orderedInterfaces = @($interfaces | Sort-Object -Property @{ Expression = { if ([int]$_.FeatureReportLength -gt 0) { 0 } else { 1 } } }, @{ Expression = { [string]$_.InstanceId } })

$synapseProcesses = @()
if ($Mode -eq 'probe') {
  $synapseProcesses = @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match 'Razer|Synapse' } |
    ForEach-Object { $_.ProcessName } |
    Sort-Object -Unique)
}

$hints = New-Object System.Collections.ArrayList
$script:razerDeadline = [DateTime]::UtcNow.AddSeconds(6)
$queryItems = New-Object System.Collections.ArrayList
foreach ($interface in $orderedInterfaces) {
  if ([DateTime]::UtcNow -gt $script:razerDeadline) {
    break
  }
  $base = $baseByPath[[string]$interface.Path]
  $featureLength = [int]$interface.FeatureReportLength
  $openModes = New-Object System.Collections.ArrayList
  $attempts = New-Object System.Collections.ArrayList
  $hintText = $null
  $accessMode = $null
  $writeMode = $null
  if ($featureLength -gt 0) {
    $rawModes = @()
    try {
      $rawModes = @([RazerHid.Hid]::ProbeOpen([string]$interface.Path))
    } catch {
      $rawModes = @()
    }
    foreach ($entry in $rawModes) {
      [void]$openModes.Add([ordered]@{
        mode = [string]$entry.Mode
        ok = [bool]$entry.Ok
        win32Error = [int]$entry.Win32Error
      })
    }
    $accessMode = Get-PreferredMode $openModes @('write', 'readwrite', 'none', 'read')
    $writeMode = Get-PreferredMode $openModes @('write', 'readwrite')
    if ($null -eq $accessMode) {
      $denied = @($openModes | Where-Object { (-not $_.ok) -and $_.win32Error -eq 5 }).Count -gt 0
      if ($denied) {
        $hintText = '需要管理员权限或退出 Razer Synapse 后重试'
        if (-not $hints.Contains($hintText)) {
          [void]$hints.Add($hintText)
        }
      }
    } else {
      $script:razerTransaction = 1
      $first = Invoke-RazerMatrix -Interface $interface -AccessMode $accessMode -WriteMode $writeMode
      foreach ($record in $first.records) {
        [void]$attempts.Add($record)
      }
      $hasResponse = @($first.records | Where-Object { ([string]$_.responseHex).Length -gt 0 }).Count -gt 0
      if (-not $hasResponse -and [DateTime]::UtcNow -le $script:razerDeadline) {
        # tx=1 无任何响应时，用 0x3F 再重试一轮（仅该接口、最多一次）
        $script:razerTransaction = 0x3F
        $second = Invoke-RazerMatrix -Interface $interface -AccessMode $accessMode -WriteMode $writeMode
        foreach ($record in $second.records) {
          [void]$attempts.Add($record)
        }
      }
    }
  }

  $item = [ordered]@{
    instanceId = $base.instanceId
    path = $base.path
    containerId = $base.containerId
    vendorId = $base.vendorId
    productId = $base.productId
    usagePage = $base.usagePage
    usage = $base.usage
    product = $base.product
    featureReportLength = $base.featureReportLength
    inputReportLength = $base.inputReportLength
    outputReportLength = $base.outputReportLength
    openMode = $(if ($null -ne $accessMode) { $accessMode } else { 'none' })
    openModes = @($openModes)
    attempts = @($attempts)
  }
  if ($null -ne $hintText) {
    $item.hint = $hintText
  }
  if ($Mode -eq 'probe') {
    $item.manufacturer = [string]$interface.Manufacturer
  }
  [void]$queryItems.Add($item)
}

if ($Mode -eq 'probe') {
  ConvertTo-Json -InputObject ([ordered]@{
    devices = @($queryItems)
    synapseProcesses = @($synapseProcesses)
    hints = @($hints)
  }) -Depth 10 -Compress
} else {
  ConvertTo-Json -InputObject @($queryItems) -Depth 10 -Compress
}
