param(
  [string]$Mode = 'list',
  [string]$Id = '',
  [string]$Value = ''
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# CoreAudio 互操作：只实现枚举 / 默认端点 / 音量与静音所需的方法
$audioCode = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace DeviceAudio
{
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        int RegisterEndpointNotificationCallback(IntPtr client);
        int UnregisterEndpointNotificationCallback(IntPtr client);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceCollection
    {
        int GetCount(out int count);
        int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice
    {
        int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        int OpenPropertyStore(int access, out IPropertyStore properties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPropertyStore
    {
        int GetCount(out int count);
        int GetAt(int index, out PROPERTYKEY key);
        int GetValue(ref PROPERTYKEY key, IntPtr value);
        int SetValue(ref PROPERTYKEY key, IntPtr value);
        int Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROPERTYKEY
    {
        public Guid fmtid;
        public int pid;
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioEndpointVolume
    {
        int NotImpl01();
        int NotImpl02();
        int NotImpl03();
        int NotImpl04();
        int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        int NotImpl06();
        int GetMasterVolumeLevelScalar(out float level);
        int NotImpl08();
        int NotImpl09();
        int NotImpl10();
        int NotImpl11();
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    public class AudioOutputInfo
    {
        public string id;
        public string name;
        public bool isDefault;
        public int volume;
        public bool muted;
    }

    public class AudioInfo
    {
        public int? masterVolume;
        public bool masterMuted;
        public AudioOutputInfo[] outputs;
    }

    public static class DeviceAudioRuntime
    {
        private const int DataFlowRender = 0;
        private const int RoleConsole = 0;
        private const int DeviceStateActive = 1;
        private const int ClsCtxAll = 23;
        private const int StgmRead = 0;
        private const int VtLpwstr = 31;
        private const int PropVariantSize = 32;

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(IntPtr value);

        private static IMMDeviceEnumerator CreateEnumerator()
        {
            Guid clsid = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
            Type type = Type.GetTypeFromCLSID(clsid, true);
            return (IMMDeviceEnumerator)Activator.CreateInstance(type);
        }

        private static string DeviceId(IMMDevice device)
        {
            string id = null;
            return device.GetId(out id) == 0 ? id : null;
        }

        private static string FriendlyName(IMMDevice device)
        {
            IPropertyStore store = null;
            if (device.OpenPropertyStore(StgmRead, out store) != 0 || store == null)
            {
                return null;
            }
            IntPtr buffer = IntPtr.Zero;
            try
            {
                PROPERTYKEY key = new PROPERTYKEY();
                key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
                key.pid = 14;
                buffer = Marshal.AllocCoTaskMem(PropVariantSize);
                for (int index = 0; index < PropVariantSize; index++)
                {
                    Marshal.WriteByte(buffer, index, 0);
                }
                if (store.GetValue(ref key, buffer) != 0)
                {
                    return null;
                }
                short vt = Marshal.ReadInt16(buffer, 0);
                if (vt != VtLpwstr)
                {
                    return null;
                }
                IntPtr text = Marshal.ReadIntPtr(buffer, 8);
                return text == IntPtr.Zero ? null : Marshal.PtrToStringUni(text);
            }
            finally
            {
                if (buffer != IntPtr.Zero)
                {
                    PropVariantClear(buffer);
                    Marshal.FreeCoTaskMem(buffer);
                }
                Marshal.ReleaseComObject(store);
            }
        }

        private static IAudioEndpointVolume OpenVolume(IMMDevice device)
        {
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object instance;
            int result = device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out instance);
            if (result != 0 || instance == null)
            {
                return null;
            }
            return instance as IAudioEndpointVolume;
        }

        private static int ClampPercent(int percent)
        {
            if (percent < 0)
            {
                return 0;
            }
            if (percent > 100)
            {
                return 100;
            }
            return percent;
        }

        private static int VolumePercent(IAudioEndpointVolume volume)
        {
            float level;
            if (volume.GetMasterVolumeLevelScalar(out level) != 0)
            {
                return 0;
            }
            return ClampPercent((int)Math.Round(level * 100.0));
        }

        private static bool VolumeMuted(IAudioEndpointVolume volume)
        {
            bool muted;
            return volume.GetMute(out muted) == 0 && muted;
        }

        private static void SetEndpointVolume(IMMDevice device, int percent)
        {
            IAudioEndpointVolume volume = OpenVolume(device);
            if (volume == null)
            {
                throw new InvalidOperationException("无法获取输出设备音量");
            }
            try
            {
                Guid context = Guid.Empty;
                float scalar = (float)(ClampPercent(percent) / 100.0);
                if (volume.SetMasterVolumeLevelScalar(scalar, ref context) != 0)
                {
                    throw new InvalidOperationException("设置音量失败");
                }
            }
            finally
            {
                Marshal.ReleaseComObject(volume);
            }
        }

        public static AudioInfo List()
        {
            AudioInfo info = new AudioInfo();
            IMMDeviceEnumerator enumerator = CreateEnumerator();
            string defaultId = null;
            IMMDevice defaultDevice = null;
            if (enumerator.GetDefaultAudioEndpoint(DataFlowRender, RoleConsole, out defaultDevice) == 0 && defaultDevice != null)
            {
                try
                {
                    defaultId = DeviceId(defaultDevice);
                    IAudioEndpointVolume volume = OpenVolume(defaultDevice);
                    if (volume != null)
                    {
                        try
                        {
                            float level;
                            if (volume.GetMasterVolumeLevelScalar(out level) == 0)
                            {
                                info.masterVolume = ClampPercent((int)Math.Round(level * 100.0));
                            }
                            info.masterMuted = VolumeMuted(volume);
                        }
                        finally
                        {
                            Marshal.ReleaseComObject(volume);
                        }
                    }
                }
                finally
                {
                    Marshal.ReleaseComObject(defaultDevice);
                }
            }

            List<AudioOutputInfo> outputs = new List<AudioOutputInfo>();
            IMMDeviceCollection collection = null;
            if (enumerator.EnumAudioEndpoints(DataFlowRender, DeviceStateActive, out collection) == 0 && collection != null)
            {
                try
                {
                    int count;
                    if (collection.GetCount(out count) == 0)
                    {
                        for (int index = 0; index < count; index++)
                        {
                            IMMDevice device = null;
                            if (collection.Item(index, out device) != 0 || device == null)
                            {
                                continue;
                            }
                            try
                            {
                                AudioOutputInfo item = new AudioOutputInfo();
                                string id = DeviceId(device);
                                item.id = id == null ? "" : id;
                                string friendlyName = FriendlyName(device);
                                item.name = string.IsNullOrEmpty(friendlyName) ? item.id : friendlyName;
                                item.isDefault = defaultId != null && defaultId == id;
                                IAudioEndpointVolume volume = OpenVolume(device);
                                if (volume != null)
                                {
                                    try
                                    {
                                        item.volume = VolumePercent(volume);
                                        item.muted = VolumeMuted(volume);
                                    }
                                    finally
                                    {
                                        Marshal.ReleaseComObject(volume);
                                    }
                                }
                                outputs.Add(item);
                            }
                            finally
                            {
                                Marshal.ReleaseComObject(device);
                            }
                        }
                    }
                }
                finally
                {
                    Marshal.ReleaseComObject(collection);
                }
            }
            info.outputs = outputs.ToArray();
            Marshal.ReleaseComObject(enumerator);
            return info;
        }

        public static void SetMasterVolume(int percent)
        {
            IMMDeviceEnumerator enumerator = CreateEnumerator();
            IMMDevice device = null;
            if (enumerator.GetDefaultAudioEndpoint(DataFlowRender, RoleConsole, out device) != 0 || device == null)
            {
                Marshal.ReleaseComObject(enumerator);
                throw new InvalidOperationException("未找到默认输出设备");
            }
            try
            {
                SetEndpointVolume(device, percent);
            }
            finally
            {
                Marshal.ReleaseComObject(device);
                Marshal.ReleaseComObject(enumerator);
            }
        }

        public static void SetDeviceVolume(string id, int percent)
        {
            IMMDeviceEnumerator enumerator = CreateEnumerator();
            IMMDevice device = null;
            if (string.IsNullOrEmpty(id) || enumerator.GetDevice(id, out device) != 0 || device == null)
            {
                Marshal.ReleaseComObject(enumerator);
                throw new InvalidOperationException("未找到指定的输出设备");
            }
            try
            {
                SetEndpointVolume(device, percent);
            }
            finally
            {
                Marshal.ReleaseComObject(device);
                Marshal.ReleaseComObject(enumerator);
            }
        }

        public static void SetMute(bool muted)
        {
            IMMDeviceEnumerator enumerator = CreateEnumerator();
            IMMDevice device = null;
            if (enumerator.GetDefaultAudioEndpoint(DataFlowRender, RoleConsole, out device) != 0 || device == null)
            {
                Marshal.ReleaseComObject(enumerator);
                throw new InvalidOperationException("未找到默认输出设备");
            }
            try
            {
                IAudioEndpointVolume volume = OpenVolume(device);
                if (volume == null)
                {
                    throw new InvalidOperationException("无法获取默认输出设备音量");
                }
                try
                {
                    Guid context = Guid.Empty;
                    if (volume.SetMute(muted, ref context) != 0)
                    {
                        throw new InvalidOperationException("设置静音状态失败");
                    }
                }
                finally
                {
                    Marshal.ReleaseComObject(volume);
                }
            }
            finally
            {
                Marshal.ReleaseComObject(device);
                Marshal.ReleaseComObject(enumerator);
            }
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $audioCode -Language CSharp -ErrorAction Stop
} catch {
  [Console]::Error.WriteLine('音频模块加载失败：' + $_.Exception.Message)
  exit 1
}

$numericValue = 0
[void][int]::TryParse([string]$Value, [ref]$numericValue)

try {
  if ($Mode -eq 'list') {
    $info = [DeviceAudio.DeviceAudioRuntime]::List()
    $outputs = New-Object System.Collections.ArrayList
    foreach ($output in $info.outputs) {
      [void]$outputs.Add([ordered]@{
        id = [string]$output.id
        name = [string]$output.name
        isDefault = [bool]$output.isDefault
        volume = [int]$output.volume
        muted = [bool]$output.muted
      })
    }
    $masterVolume = $null
    if ($null -ne $info.masterVolume) {
      $masterVolume = [int]$info.masterVolume
    }
    $result = [ordered]@{
      masterVolume = $masterVolume
      masterMuted = [bool]$info.masterMuted
      outputs = @($outputs)
    }
    Write-Output (ConvertTo-Json -InputObject $result -Depth 6 -Compress)
  } elseif ($Mode -eq 'set-master') {
    [DeviceAudio.DeviceAudioRuntime]::SetMasterVolume($numericValue)
    Write-Output (ConvertTo-Json -InputObject ([ordered]@{ ok = $true }) -Compress)
  } elseif ($Mode -eq 'set-device') {
    [DeviceAudio.DeviceAudioRuntime]::SetDeviceVolume([string]$Id, $numericValue)
    Write-Output (ConvertTo-Json -InputObject ([ordered]@{ ok = $true }) -Compress)
  } elseif ($Mode -eq 'set-mute') {
    $muted = $false
    if ([string]$Value -eq 'true' -or [string]$Value -eq '1') {
      $muted = $true
    }
    [DeviceAudio.DeviceAudioRuntime]::SetMute($muted)
    Write-Output (ConvertTo-Json -InputObject ([ordered]@{ ok = $true }) -Compress)
  } else {
    [Console]::Error.WriteLine('未知模式：' + $Mode)
    exit 1
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
