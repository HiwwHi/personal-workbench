param([switch]$Silent)

# 个人工作台 - 托盘常驻启动器
#   双击后：无黑框 -> 后台起服务 -> 托盘出图标 ->（非静默时）自动开浏览器
#   -Silent：开机自启时使用，只起服务不开浏览器

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$defaultPort = 8733
$maxPort = 8742          # 默认端口被别的程序占用时，依次往后找（与 electron 版保持一致）
$port = $defaultPort
$url = "http://127.0.0.1:$port"
$ico = Join-Path $root 'app.ico'
$log = Join-Path $root 'tray.log'

function Write-Log($m) {
  try { "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m | Out-File -FilePath $script:log -Append -Encoding UTF8 } catch { }
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ---------------------------------------------------------------- 单实例
$created = $false
$mtx = New-Object System.Threading.Mutex($true, 'Global\WorkbenchTray8733', [ref]$created)
if (-not $created) {
  if (-not $Silent) { Start-Process $url }
  exit 0
}

# ---------------------------------------------------------------- 定位 node
# 顺序：项目自带 runtime -> WorkBuddy/CodeBuddy 自带 -> 系统安装 -> PATH
$candidates = New-Object System.Collections.Generic.List[string]
$candidates.Add((Join-Path $root 'runtime\node.exe'))
$wbNodeRoot = Join-Path $env:USERPROFILE '.workbuddy\binaries\node\versions'
if (Test-Path $wbNodeRoot) {
  Get-ChildItem -Path $wbNodeRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { $candidates.Add((Join-Path $_.FullName 'node.exe')) }
}
$candidates.Add('C:\Program Files\nodejs\node.exe')
$candidates.Add('C:\Program Files (x86)\nodejs\node.exe')
$candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))
$node = $null
foreach ($c in $candidates) { if (Test-Path $c) { $node = $c; break } }
if (-not $node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}
if (-not $node -or -not (Test-Path $node)) {
  [System.Windows.Forms.MessageBox]::Show(
    "未找到 Node.js。`n请安装 Node.js（https://nodejs.org），`n或把 node.exe 放到项目 runtime 目录下。",
    '个人工作台') | Out-Null
  exit 1
}

# ---------------------------------------------------------------- 工具函数
function Test-Port {
  param($p)
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); $c.Close(); return $true } catch { return $false }
}

function Test-Workbench {
  # 判断端口上是不是本工作台
  param($p)
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$p/api/ping" -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200 -and $r.Content -match 'personal-workbench')
  }
  catch { return $false }
}

function Start-Server {
  for ($p = $script:defaultPort; $p -le $script:maxPort; $p++) {
    if (Test-Port $p) {
      # 端口已被占用：是本工作台就复用，是别的程序就换下一个
      if (Test-Workbench $p) {
        $script:port = $p; $script:url = "http://127.0.0.1:$p"
        Write-Log ("reuse running server on " + $p)
        return $true
      }
      continue
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:node
    $psi.Arguments = "server.js $p"
    $psi.WorkingDirectory = $script:root
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.UseShellExecute = $true
    [void][System.Diagnostics.Process]::Start($psi)
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 300
      if (Test-Port $p) {
        $script:port = $p; $script:url = "http://127.0.0.1:$p"
        return $true
      }
    }
  }
  return $false
}

function Stop-Server {
  # 只杀监听本工作台端口的进程，避免误杀别的项目里的 node
  $targetIds = @()
  try {
    $targetIds = @(Get-NetTCPConnection -LocalPort $script:port -State Listen -ErrorAction Stop |
                   Select-Object -ExpandProperty OwningProcess)
  }
  catch {
    # 老系统没有 Get-NetTCPConnection，退回 netstat
    $targetIds = @(netstat -ano | ForEach-Object {
      if ($_ -match ":$($script:port)\s+\S+\s+LISTENING\s+(\d+)\s*$") { $matches[1] }
    })
  }
  foreach ($procId in ($targetIds | Where-Object { $_ } | Select-Object -Unique)) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Log ("server stopped: pid " + $procId)
    }
  }
}

function New-Icon {
  if (Test-Path $script:ico) { return }
  $bmp = New-Object System.Drawing.Bitmap 64, 64
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 74, 111, 138))
  $g.FillEllipse($bg, 1, 1, 62, 62)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 5
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($pen, 19, 22, 45, 22)
  $g.DrawLine($pen, 19, 32, 45, 32)
  $g.DrawLine($pen, 19, 42, 36, 42)
  $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $fs = [System.IO.File]::Open($script:ico, 'Create', 'Write')
  $icon.Save($fs)
  $fs.Close()
  $icon.Dispose()
  $bmp.Dispose()
}

$startupFile = Join-Path ([Environment]::GetFolderPath('Startup')) 'Workbench-Autostart.vbs'

function Test-AutoStart {
  return (Test-Path $script:startupFile)
}

function Set-AutoStart {
  param([bool]$on)
  if ($on) {
    $vbs = Join-Path $script:root 'start-workbench.vbs'
    $line = 'sh.Run """" & WScript.FullName & """ """ & "' + $vbs + '" & """ /silent", 0, False'
    $body = @(
      'On Error Resume Next',
      'Set sh = CreateObject("WScript.Shell")',
      $line
    )
    Set-Content -Path $script:startupFile -Value $body -Encoding Unicode
  }
  else {
    if (Test-Path $script:startupFile) { Remove-Item $script:startupFile -Force }
  }
}

# ---------------------------------------------------------------- 起服务
try {
  New-Icon
  $ok = Start-Server
  Write-Log ("server started: " + $ok)

  if ($ok -and -not $Silent) { Start-Process $url }
  if (-not $ok) {
    [System.Windows.Forms.MessageBox]::Show("服务启动失败：端口 $defaultPort~$maxPort 都被占用。`n请关掉占用端口的程序后重试，详见 tray.log", '个人工作台') | Out-Null
    exit 1
  }
}
catch {
  Write-Log ("ERR " + $_.Exception.Message)
  [System.Windows.Forms.MessageBox]::Show("启动出错：`n" + $_.Exception.Message, '个人工作台') | Out-Null
  exit 1
}

# ---------------------------------------------------------------- 托盘图标
[System.Windows.Forms.Application]::EnableVisualStyles()

$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = New-Object System.Drawing.Icon $ico
$ni.Text = "个人工作台  ·  $url"
$ni.Visible = $true

$mOpen = New-Object System.Windows.Forms.MenuItem '打开工作台'
$mOpen.DefaultItem = $true
$mOpen.Add_Click({ Start-Process $script:url })

$mSep1 = New-Object System.Windows.Forms.MenuItem '-'

$mAuto = New-Object System.Windows.Forms.MenuItem '开机自动启动'
$mAuto.Checked = Test-AutoStart
$mAuto.Add_Click({
  $next = -not $mAuto.Checked
  Set-AutoStart $next
  $mAuto.Checked = $next
})

$mSep2 = New-Object System.Windows.Forms.MenuItem '-'

$mHide = New-Object System.Windows.Forms.MenuItem '退出托盘图标（服务继续运行）'
$mHide.Add_Click({ $script:ni.Visible = $false; [System.Windows.Forms.Application]::Exit() })

$mQuit = New-Object System.Windows.Forms.MenuItem '停止服务并退出'
$mQuit.Add_Click({ Stop-Server; $script:ni.Visible = $false; [System.Windows.Forms.Application]::Exit() })

$menu = New-Object System.Windows.Forms.ContextMenu
$menu.MenuItems.AddRange([System.Windows.Forms.MenuItem[]]@($mOpen, $mSep1, $mAuto, $mSep2, $mHide, $mQuit))
$ni.ContextMenu = $menu
$ni.Add_Click({ if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Start-Process $script:url } })

if ($Silent) {
  $ni.ShowBalloonTip(4000, '个人工作台', '已在后台启动，点击托盘图标打开', [System.Windows.Forms.ToolTipIcon]::Info)
}

[System.Windows.Forms.Application]::Run()
$ni.Dispose()
