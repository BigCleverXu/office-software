param(
  [string]$Mode = 'list'
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 设备属性互操作：Get-PnpDeviceProperty 的批量结果在 PS 5.1 下 InstanceId 会错乱，
# 这里用 CfgMgr32 精确读取 BusReportedDeviceDesc（每次调用毫秒级）
$propertyCode = @'
using System;
using System.Runtime.InteropServices;

namespace DeviceProps
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct DEVPROPKEY { public Guid fmtid; public uint pid; }

    public static class PnpProperties
    {
        private const string BusReportedFmtid = "540b947e-8b40-45bc-a8a2-6a0b894cbda2";

        [DllImport("CfgMgr32.dll", CharSet = CharSet.Unicode)]
        private static extern int CM_Locate_DevNodeW(out uint devInst, string deviceId, uint flags);

        [DllImport("CfgMgr32.dll")]
        private static extern int CM_Get_DevNode_PropertyW(uint devInst, ref DEVPROPKEY key, out uint propertyType, IntPtr buffer, ref uint bufferSize, uint flags);

        public static string GetBusReportedDeviceDesc(string deviceId)
        {
            uint devInst;
            if (CM_Locate_DevNodeW(out devInst, deviceId, 0) != 0)
            {
                return null;
            }
            DEVPROPKEY key = new DEVPROPKEY();
            key.fmtid = new Guid(BusReportedFmtid);
            key.pid = 4;
            uint size = 1024;
            IntPtr buffer = Marshal.AllocHGlobal((int)size);
            try
            {
                uint propertyType;
                int result = CM_Get_DevNode_PropertyW(devInst, ref key, out propertyType, buffer, ref size, 0);
                if (result != 0)
                {
                    return null;
                }
                string text = Marshal.PtrToStringUni(buffer);
                return string.IsNullOrEmpty(text) ? null : text;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private static int? GetPercentProperty(string deviceId, int pid)
        {
            uint devInst;
            if (CM_Locate_DevNodeW(out devInst, deviceId, 0) != 0)
            {
                return null;
            }
            DEVPROPKEY key = new DEVPROPKEY();
            key.fmtid = new Guid("104ea319-6ee2-4701-bd47-8ddbf425bbe5");
            key.pid = (uint)pid;
            uint size = 64;
            IntPtr buffer = Marshal.AllocHGlobal((int)size);
            try
            {
                uint propertyType;
                int result = CM_Get_DevNode_PropertyW(devInst, ref key, out propertyType, buffer, ref size, 0);
                if (result != 0)
                {
                    return null;
                }
                if (propertyType == 3 && size >= 1)
                {
                    byte value = Marshal.ReadByte(buffer);
                    return value <= 100 ? (int?)value : null;
                }
                if (propertyType == 7 && size >= 4)
                {
                    int value = Marshal.ReadInt32(buffer);
                    return value >= 0 && value <= 100 ? (int?)value : null;
                }
                return null;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public static int? GetBatteryLevel(string deviceId)
        {
            return GetPercentProperty(deviceId, 2);
        }

        public static int? GetAepValue(string deviceId, int pid)
        {
            return GetPercentProperty(deviceId, pid);
        }
    }
}
'@

$propertyHelperReady = $false
try {
  Add-Type -TypeDefinition $propertyCode -Language CSharp -ErrorAction Stop
  $propertyHelperReady = $true
} catch {
  $propertyHelperReady = $false
}

# 是否为蓝牙枚举节点（BTHENUM / BTHLE）
function Test-BluetoothInstance {
  param([string]$InstanceId)
  return ($InstanceId -match '^BTH(ENUM|LE)\\')
}

# 从数字 / "100;1" 等复合值中提取第一个 0–100 整数
function ConvertTo-BatteryPercent {
  param($Value)
  if ($null -eq $Value) {
    return $null
  }
  if ($Value -is [byte] -or $Value -is [int] -or $Value -is [long] -or $Value -is [double]) {
    $number = [double]$Value
    if ($number -ge 0 -and $number -le 100) {
      return [int][Math]::Round($number)
    }
    return $null
  }
  $text = [string]$Value
  foreach ($match in [regex]::Matches($text, '\d+')) {
    $level = 0
    if ([int]::TryParse($match.Value, [ref]$level)) {
      if ($level -ge 0 -and $level -le 100) {
        return $level
      }
    }
  }
  return $null
}

# WinRT 异步操作的反射桥接，仅在 AEP 兜底枚举时使用
$asTaskGeneric = $null
function Await {
  param($Operation, $ResultType, [int]$TimeoutMs = 1000)
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $task = $asTask.Invoke($null, @($Operation))
  if (-not $task.Wait($TimeoutMs)) {
    return $null
  }
  $task.Result
}

# 只关注与设备管理相关的 PnP 类别；MEDIA 只保留蓝牙音频节点，
# System 只保留蓝牙 HFP（AudioGateway）服务节点，其余驱动/软件节点继续排除
$classes = @('Mouse', 'Keyboard', 'Monitor', 'Bluetooth', 'HIDClass', 'MEDIA', 'System')

# 设备主体优先用 WMI 枚举（比 CIM 快数倍），不可用或为空时回退 CIM；
# 只投影需要的属性，Name / DeviceID / PNPClass / Manufacturer 均已提供
$deviceFilter = {
  ($classes -contains [string]$_.PNPClass) -and
  ($_.Status -eq 'OK') -and
  ([string]$_.DeviceID -notmatch '^(SWD|ROOT|VHF|INTELAUDIO)\\') -and
  ([string]$_.PNPClass -ne 'MEDIA' -or [string]$_.DeviceID -match '^BTH(ENUM|LE)\\') -and
  ([string]$_.PNPClass -ne 'System' -or [string]$_.DeviceID -match '^BTHENUM\\\{0000111[EF]-')
}

$devices = @()
try {
  $devices = @(Get-WmiObject Win32_PnPEntity -Property Name, DeviceID, PNPClass, Manufacturer, Status -ErrorAction Stop | Where-Object $deviceFilter)
} catch {
  $devices = @()
}
if ($devices.Count -eq 0) {
  $devices = @(Get-CimInstance Win32_PnPEntity -Property Name, DeviceID, PNPClass, Manufacturer, Status -ErrorAction SilentlyContinue | Where-Object $deviceFilter)
}

$instanceIds = @($devices |
  ForEach-Object { [string]$_.DeviceID } |
  Where-Object { $_ -ne '' })

# 容器 id 与总线名称优先读注册表：注册表 ContainerID 每次都能准确归属
$enumRoot = 'HKLM:\SYSTEM\CurrentControlSet\Enum'
$invalidContainerPattern = '^\{?(0{8}-0{4}-0{4}-0{4}-0{12}|00000000-0000-0000-ffff-ffffffffffff)\}?$'
$registryContainerMap = @{}
$registryBusNameMap = @{}
foreach ($device in $devices) {
  $instanceId = [string]$device.DeviceID
  if ($instanceId -eq '') {
    continue
  }
  $key = $instanceId.ToLowerInvariant()
  try {
    $values = Get-ItemProperty -LiteralPath ($enumRoot + '\' + $instanceId) -ErrorAction Stop
    if ($null -ne $values.ContainerID) {
      $containerId = ([string]$values.ContainerID).Trim()
      if ($containerId -ne '' -and $containerId -notmatch $invalidContainerPattern) {
        $registryContainerMap[$key] = $containerId
      }
    }
    $busName = ''
    if ($null -ne $values.BusReportedDeviceDesc) {
      $busName = ([string]$values.BusReportedDeviceDesc).Trim()
    }
    if ($busName -eq '' -and $null -ne $values.FriendlyName) {
      $busName = ([string]$values.FriendlyName).Trim()
    }
    # FriendlyName 可能是 "@驱动,#资源;文本" 形式的间接字符串，不可直接展示
    if ($busName -ne '' -and -not $busName.StartsWith('@')) {
      $registryBusNameMap[$key] = $busName
    }
  } catch {
    # 注册表键不可读时保留后续回退
  }
  if (-not $registryBusNameMap.ContainsKey($key) -and $propertyHelperReady) {
    try {
      $busName = [DeviceProps.PnpProperties]::GetBusReportedDeviceDesc($instanceId)
      if ($null -ne $busName) {
        $busName = ([string]$busName).Trim()
        if ($busName -ne '') {
          $registryBusNameMap[$key] = $busName
        }
      }
    } catch {
      # 单条属性读取失败按无名称处理
    }
  }
}

# 电量逐设备用 CfgMgr32 读取（毫秒级），避免批量 cmdlet 的 2 秒级开销；
# 仅当 C# 助手不可用时回退一次性批量查询
$batteryPropertyKey = 'DEVPKEY_Device_BatteryLevel'
$batteryClasses = @('Mouse', 'Keyboard', 'Bluetooth', 'HIDClass', 'MEDIA', 'System')
$batteryMap = @{}
if ($propertyHelperReady) {
  foreach ($device in $devices) {
    if ($batteryClasses -notcontains [string]$device.PNPClass) {
      continue
    }
    $instanceId = [string]$device.DeviceID
    if ($instanceId -eq '') {
      continue
    }
    try {
      $level = [DeviceProps.PnpProperties]::GetBatteryLevel($instanceId)
      if ($null -ne $level) {
        $batteryMap[$instanceId.ToLowerInvariant()] = [int]$level
      }
    } catch {
      # 单条读取失败视为无电量
    }
  }
} else {
  $batteryIds = @($devices |
    Where-Object { $batteryClasses -contains [string]$_.PNPClass } |
    ForEach-Object { [string]$_.DeviceID } |
    Where-Object { $_ -ne '' })
  if ($batteryIds.Count -gt 0) {
    try {
      $rows = @(Get-PnpDeviceProperty -InstanceId @($batteryIds) -KeyName $batteryPropertyKey -ErrorAction Stop)
    } catch {
      $rows = @()
    }
    foreach ($row in $rows) {
      $rowId = [string]$row.InstanceId
      if ([string]::IsNullOrWhiteSpace($rowId) -or $null -eq $row.Data) {
        continue
      }
      $level = 0
      if ([int]::TryParse([string]$row.Data, [ref]$level) -and $level -ge 0 -and $level -le 100) {
        $key = $rowId.ToLowerInvariant()
        if (-not $batteryMap.ContainsKey($key)) {
          $batteryMap[$key] = $level
        }
      }
    }
  }
}

$batchContainerMap = @{}
$batchBusNameMap = @{}
if (-not $propertyHelperReady -and $instanceIds.Count -gt 0) {
  foreach ($key in @('DEVPKEY_Device_ContainerId', 'DEVPKEY_Device_BusReportedDeviceDesc')) {
    try {
      $rows = @(Get-PnpDeviceProperty -InstanceId $instanceIds -KeyName $key -ErrorAction Stop)
      foreach ($row in $rows) {
        if ($null -eq $row.Data) {
          continue
        }
        $rowId = ([string]$row.InstanceId).ToLowerInvariant()
        $text = ([string]$row.Data).Trim()
        if ($text -eq '') {
          continue
        }
        if ($key -eq 'DEVPKEY_Device_ContainerId') {
          if ($text -notmatch $invalidContainerPattern) {
            $batchContainerMap[$rowId] = $text
          }
        } else {
          $batchBusNameMap[$rowId] = $text
        }
      }
    } catch {
      # 回退查询失败按无值处理
    }
  }
}

# 蓝牙设备电量多源降级：PnP BatteryLevel > AEP BatteryLife > AEP BatteryPlusCharging
# 额外查询只对 BTHENUM / BTHLE 设备逐条执行（通常 0–5 条）
$aepBatteryKey = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$aepChargingKey = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 3'
$aepBatteryMap = @{}
$aepChargingMap = @{}
$batterySourceMap = @{}
foreach ($device in $devices) {
  $instanceId = [string]$device.DeviceID
  if ($instanceId -eq '' -or -not (Test-BluetoothInstance $instanceId)) {
    continue
  }
  $key = $instanceId.ToLowerInvariant()
  $aepBattery = $null
  $aepCharging = $null
  if ($propertyHelperReady) {
    # CfgMgr32 毫秒级读取 AEP 属性，避免逐条 cmdlet 的 1.3 秒开销
    try {
      $aepBattery = [DeviceProps.PnpProperties]::GetAepValue($instanceId, 2)
    } catch {
      $aepBattery = $null
    }
    try {
      $aepCharging = [DeviceProps.PnpProperties]::GetAepValue($instanceId, 3)
    } catch {
      $aepCharging = $null
    }
  } else {
    try {
      $row = Get-PnpDeviceProperty -InstanceId $instanceId -KeyName $aepBatteryKey -ErrorAction Stop | Select-Object -First 1
      if ($null -ne $row) {
        $aepBattery = ConvertTo-BatteryPercent $row.Data
      }
    } catch {
      # 属性缺失按无值处理
    }
    try {
      $row = Get-PnpDeviceProperty -InstanceId $instanceId -KeyName $aepChargingKey -ErrorAction Stop | Select-Object -First 1
      if ($null -ne $row) {
        $aepCharging = ConvertTo-BatteryPercent $row.Data
      }
    } catch {
      # 属性缺失按无值处理
    }
  }
  if ($null -ne $aepBattery) {
    $aepBatteryMap[$key] = [int]$aepBattery
  }
  if ($null -ne $aepCharging) {
    $aepChargingMap[$key] = [int]$aepCharging
  }
  if ($batteryMap.ContainsKey($key)) {
    $batterySourceMap[$key] = 'pnp'
  } elseif ($null -ne $aepBattery) {
    $batteryMap[$key] = [int]$aepBattery
    $batterySourceMap[$key] = 'aep-battery'
  } elseif ($null -ne $aepCharging) {
    $batteryMap[$key] = [int]$aepCharging
    $batterySourceMap[$key] = 'aep-charging'
  } else {
    $batterySourceMap[$key] = 'none'
  }
}

# WinRT AEP 兜底：部分蓝牙设备的电量只存在于关联端点（AEP），可能没有 PnP 节点。
# 只有「已连接的蓝牙音频设备仍无电量」时才执行，避免轮询时无谓等待；
# 整体 try/catch，失败不影响主体 JSON 输出
$audioNamePattern = '耳机|headset|headphone|airpods|buds|音箱|speaker'
$needAepEnumeration = $Mode -eq 'probe'
if (-not $needAepEnumeration) {
  # HFP 等同容器节点已有电量时，视为该物理设备电量已就绪
  $audioContainersWithBattery = @{}
  $audioNamesWithBattery = @{}
  foreach ($device in $devices) {
    $instanceId = [string]$device.DeviceID
    if ($instanceId -notmatch '^BTH(ENUM|LE)\\') {
      continue
    }
    $key = $instanceId.ToLowerInvariant()
    if (-not $batteryMap.ContainsKey($key)) {
      continue
    }
    $name = [string]$device.Name
    $isAudio = ([string]$device.PNPClass -match '^(MEDIA|System)$') -or
      ($instanceId -match '^BTHENUM\\\{0000111[EF]-') -or
      ($name -match $audioNamePattern)
    if (-not $isAudio) {
      continue
    }
    $containerId = $null
    if ($registryContainerMap.ContainsKey($key)) {
      $containerId = [string]$registryContainerMap[$key]
    }
    if ($null -ne $containerId -and $containerId -ne '') {
      $audioContainersWithBattery[$containerId.ToLowerInvariant()] = $true
    }
    $audioNamesWithBattery[($name -replace '[^0-9A-Za-z\u4e00-\u9fa5]', '').ToLowerInvariant()] = $true
  }
  foreach ($device in $devices) {
    $instanceId = [string]$device.DeviceID
    if ($instanceId -notmatch '^BTH(ENUM|LE)\\') {
      continue
    }
    $key = $instanceId.ToLowerInvariant()
    if ($batteryMap.ContainsKey($key)) {
      continue
    }
    $name = [string]$device.Name
    $isAudio = ([string]$device.PNPClass -match '^(MEDIA|System)$') -or
      ($instanceId -match '^BTHENUM\\\{0000111[EF]-') -or
      ($name -match $audioNamePattern)
    if (-not $isAudio) {
      continue
    }
    $containerId = $null
    if ($registryContainerMap.ContainsKey($key)) {
      $containerId = [string]$registryContainerMap[$key]
    }
    if ($null -ne $containerId -and $audioContainersWithBattery.ContainsKey($containerId.ToLowerInvariant())) {
      continue
    }
    $nameKey = ($name -replace '[^0-9A-Za-z\u4e00-\u9fa5]', '').ToLowerInvariant()
    if ($audioNamesWithBattery.ContainsKey($nameKey)) {
      continue
    }
    $needAepEnumeration = $true
    break
  }
}

$aepDevices = New-Object System.Collections.ArrayList
$aepRows = New-Object System.Collections.ArrayList
if ($needAepEnumeration) {
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
  $null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
  $null = [Windows.Devices.Enumeration.DeviceInformationKind, Windows.Devices.Enumeration, ContentType=WindowsRuntime]
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  if ($null -ne $asTaskGeneric) {
    # FindAllAsync 的三参重载要求 IEnumerable<string>，直接传 Object[] 无法绑定
    $aepProperties = New-Object 'System.Collections.Generic.List[string]'
    foreach ($propertyName in @(
        'System.Devices.Aep.DeviceAddress',
        'System.Devices.Aep.IsConnected',
        'System.Devices.BatteryLife',
        'System.Devices.BatteryPlusCharging'
      )) {
      [void]$aepProperties.Add($propertyName)
    }
    $aepProtocols = @(
      'System.Devices.Aep.ProtocolId:="{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}"',
      'System.Devices.Aep.ProtocolId:="{bb7bb05e-5972-42b5-94fc-76eaa7084d49}"'
    )
    $aepSeen = @{}
    # 正常扫描必须控制总耗时；probe 为诊断模式可等待系统完成 AEP 枚举
    $aepWaitMs = 1200
    if ($Mode -eq 'probe') {
      $aepWaitMs = 40000
    }
    foreach ($protocol in $aepProtocols) {
      try {
        $operation = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync(
          $protocol,
          $aepProperties,
          [Windows.Devices.Enumeration.DeviceInformationKind]::AssociationEndpoint
        )
        $collection = Await $operation ([Windows.Devices.Enumeration.DeviceInformationCollection]) $aepWaitMs
        if ($null -eq $collection) {
          if ($Mode -eq 'probe') {
            [Console]::Error.WriteLine('AEP 枚举超时，已跳过')
          }
          continue
        }
        foreach ($info in @($collection)) {
          # DeviceInformation.Properties 是 COM 映射，索引器取不到值，需遍历 KeyValuePair
          $propertyMap = @{}
          foreach ($kv in @($info.Properties)) {
            $propertyMap[[string]$kv.Key] = $kv.Value
          }
          $isConnected = $false
          if ($propertyMap.ContainsKey('System.Devices.Aep.IsConnected')) {
            $isConnected = [bool]$propertyMap['System.Devices.Aep.IsConnected']
          }
          $address = ''
          if ($propertyMap.ContainsKey('System.Devices.Aep.DeviceAddress')) {
            $address = [string]$propertyMap['System.Devices.Aep.DeviceAddress']
          }
          $batteryLife = $null
          if ($propertyMap.ContainsKey('System.Devices.BatteryLife')) {
            $batteryLife = ConvertTo-BatteryPercent $propertyMap['System.Devices.BatteryLife']
          }
          $batteryPlus = $null
          if ($propertyMap.ContainsKey('System.Devices.BatteryPlusCharging')) {
            $batteryPlus = ConvertTo-BatteryPercent $propertyMap['System.Devices.BatteryPlusCharging']
          }
          $name = [string]$info.Name
          [void]$aepDevices.Add([ordered]@{
            name = $name
            address = $address
            batteryLife = $batteryLife
            batteryPlusCharging = $batteryPlus
            isConnected = $isConnected
          })
          if (-not $isConnected) {
            continue
          }
          if ($null -eq $batteryLife -and $null -eq $batteryPlus -and $name -notmatch $audioNamePattern) {
            continue
          }
          if ($address -ne '' -and $aepSeen.ContainsKey($address)) {
            continue
          }
          if ($address -ne '') {
            $aepSeen[$address] = $true
          }
          $batteryLevel = $null
          $source = 'none'
          if ($null -ne $batteryLife) {
            $batteryLevel = [int]$batteryLife
            $source = 'aep-battery'
          } elseif ($null -ne $batteryPlus) {
            $batteryLevel = [int]$batteryPlus
            $source = 'aep-charging'
          }
          [void]$aepRows.Add([ordered]@{
            id = "AEP\$address"
            name = $name
            class = 'BluetoothAep'
            instanceId = "AEP\$address"
            vendor = $null
            battery = $batteryLevel
            containerId = $null
            busName = $null
            batterySource = $source
          })
        }
      } catch {
        [Console]::Error.WriteLine('AEP 枚举失败：' + $_.Exception.Message)
      }
    }
  }
} catch {
  [Console]::Error.WriteLine('AEP 初始化失败：' + $_.Exception.Message)
}
}

# 诊断模式：输出全部候选设备的原始属性，不进入 UI、不做任何写操作
if ($Mode -eq 'probe') {
  $probeDevices = New-Object System.Collections.ArrayList
  foreach ($device in $devices) {
    $instanceId = [string]$device.DeviceID
    $key = $instanceId.ToLowerInvariant()
    $batteryLevel = $null
    if ($batteryMap.ContainsKey($key)) {
      $batteryLevel = [int]$batteryMap[$key]
    }
    $aepBattery = $null
    if ($aepBatteryMap.ContainsKey($key)) {
      $aepBattery = [int]$aepBatteryMap[$key]
    }
    $aepCharging = $null
    if ($aepChargingMap.ContainsKey($key)) {
      $aepCharging = [int]$aepChargingMap[$key]
    }
    $containerId = $null
    if ($registryContainerMap.ContainsKey($key)) {
      $containerId = [string]$registryContainerMap[$key]
    } elseif ($batchContainerMap.ContainsKey($key)) {
      $containerId = [string]$batchContainerMap[$key]
    }
    $busName = $null
    if ($registryBusNameMap.ContainsKey($key)) {
      $busName = [string]$registryBusNameMap[$key]
    } elseif ($batchBusNameMap.ContainsKey($key)) {
      $busName = [string]$batchBusNameMap[$key]
    }
    $name = [string]$device.Name
    if ([string]::IsNullOrWhiteSpace($name)) {
      $name = $instanceId
    }
    [void]$probeDevices.Add([ordered]@{
      instanceId = $instanceId
      name = $name
      class = [string]$device.PNPClass
      batteryLevel = $batteryLevel
      aepBattery = $aepBattery
      aepCharging = $aepCharging
      containerId = $containerId
      busName = $busName
      status = [string]$device.Status
    })
  }
  ConvertTo-Json -InputObject ([ordered]@{
    devices = @($probeDevices)
    aepDevices = @($aepDevices)
  }) -Depth 6 -Compress
  exit 0
}

$items = New-Object System.Collections.ArrayList
foreach ($device in $devices) {
  $instanceId = [string]$device.DeviceID
  $name = [string]$device.Name
  if ([string]::IsNullOrWhiteSpace($name)) {
    $name = $instanceId
  }

  $vendor = [string]$device.Manufacturer
  if ([string]::IsNullOrWhiteSpace($vendor)) {
    $vendor = $null
  }

  $key = $instanceId.ToLowerInvariant()

  $battery = $null
  if ($batteryMap.ContainsKey($key)) {
    $battery = [int]$batteryMap[$key]
  }
  $batterySource = 'none'
  if ($battery -ne $null) {
    $batterySource = 'pnp'
  }
  if ($batterySourceMap.ContainsKey($key)) {
    $batterySource = [string]$batterySourceMap[$key]
  }

  $containerId = $null
  if ($registryContainerMap.ContainsKey($key)) {
    $containerId = [string]$registryContainerMap[$key]
  } elseif ($batchContainerMap.ContainsKey($key)) {
    $containerId = [string]$batchContainerMap[$key]
  }

  $busName = $null
  if ($registryBusNameMap.ContainsKey($key)) {
    $busName = [string]$registryBusNameMap[$key]
  } elseif ($batchBusNameMap.ContainsKey($key)) {
    $busName = [string]$batchBusNameMap[$key]
  }

  [void]$items.Add([ordered]@{
    id = $instanceId
    name = $name
    class = [string]$device.PNPClass
    instanceId = $instanceId
    vendor = $vendor
    battery = $battery
    batterySource = $batterySource
    containerId = $containerId
    busName = $busName
  })
}

# AEP 合成行追加到输出数组
foreach ($row in $aepRows) {
  [void]$items.Add($row)
}

# 用 -InputObject 承载数组，保证单元素时仍输出 JSON 数组
ConvertTo-Json -InputObject @($items) -Depth 6 -Compress
