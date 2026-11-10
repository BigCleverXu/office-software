/**
 * ASR 内置资源的平台计划（纯函数，无副作用）
 *
 * 描述当前构建平台需要哪些 whisper / ffmpeg 产物、如何获取，
 * 由 scripts/fetch-asr-assets.mjs 使用，也供单元测试直接校验。
 */

/** whisper.cpp 预编译包（Windows x64，直连 GitHub，失败时走加速镜像） */
const WHISPER_ZIP = {
  urls: [
    'https://github.com/ggml-org/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip',
    'https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip',
    'https://ghproxy.net/https://github.com/ggml-org/whisper.cpp/releases/download/v1.6.0/whisper-bin-x64.zip'
  ],
  sha256: '0F60FC3318772F4D678E0EB022B08E143D7E8F43C647C0ACFF5C68BB126B1B02',
  size: 2249966
}

/** whisper.cpp 源码包（macOS 本地编译，直连 GitHub，失败时走加速镜像） */
const WHISPER_SOURCE = {
  version: 'v1.6.0',
  urls: [
    'https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.6.0.tar.gz',
    'https://gh-proxy.com/https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.6.0.tar.gz',
    'https://ghproxy.net/https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.6.0.tar.gz'
  ]
}

/**
 * 解析指定平台的资源获取计划。
 *
 * @param {string} platform Node 的 process.platform
 * @param {string} arch Node 的 process.arch
 */
export function resolveAssetPlan(platform, arch) {
  if (platform === 'win32') {
    return {
      supported: true,
      platform,
      arch,
      unsupportedReason: null,
      whisper: {
        kind: 'prebuilt-zip',
        files: [
          { name: 'main.exe', size: 148480 },
          { name: 'whisper.dll', size: 933888 }
        ],
        executable: 'main.exe',
        zip: WHISPER_ZIP
      },
      ffmpegName: 'ffmpeg.exe',
      chmod: false,
      executableMode: null
    }
  }

  if (platform === 'darwin') {
    return {
      supported: true,
      platform,
      arch,
      unsupportedReason: null,
      whisper: {
        kind: 'build-from-source',
        files: [
          {
            name: 'whisper-cli',
            outputCandidates: ['whisper-cli', 'main']
          }
        ],
        executable: 'whisper-cli',
        source: WHISPER_SOURCE,
        cmake: {
          configure: [
            '-DCMAKE_BUILD_TYPE=Release',
            '-DWHISPER_BUILD_TESTS=OFF'
          ],
          fallbackConfigure: ['-DGGML_METAL=OFF']
        }
      },
      ffmpegName: 'ffmpeg',
      chmod: true,
      executableMode: 0o755
    }
  }

  return {
    supported: false,
    platform,
    arch,
    unsupportedReason: `暂不支持平台 ${platform}：内置口播运行时仅覆盖 Windows 与 macOS`,
    whisper: null,
    ffmpegName: null,
    chmod: false,
    executableMode: null
  }
}
