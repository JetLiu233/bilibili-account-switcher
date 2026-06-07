# 生成扩展图标:bilibili 蓝圆角方块 + 白色双向切换箭头。
# 用法(Windows PowerShell):  powershell -ExecutionPolicy Bypass -File scripts\generate-icons.ps1
# 依赖 .NET 的 System.Drawing,输出到 ../icons/icon{16,32,48,128}.png
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$blue  = [System.Drawing.Color]::FromArgb(255, 0, 174, 236)   # #00AEEC
$white = [System.Drawing.Color]::White

function New-Icon([int]$S) {
  $bmp = New-Object System.Drawing.Bitmap($S, $S)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # 圆角矩形背景
  $m = [float]($S * 0.03)
  $w = [float]($S - 2 * $m)
  $d = [float]($S * 0.44)   # 圆角直径
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($m,            $m,            $d, $d, 180, 90)
  $path.AddArc($m + $w - $d,  $m,            $d, $d, 270, 90)
  $path.AddArc($m + $w - $d,  $m + $w - $d,  $d, $d,   0, 90)
  $path.AddArc($m,            $m + $w - $d,  $d, $d,  90, 90)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush($blue)
  $g.FillPath($brush, $path)

  # 白色双向切换箭头(上箭头朝右、下箭头朝左)
  $penW = [float]([Math]::Max(1.5, $S * 0.085))
  $pen = New-Object System.Drawing.Pen($white, $penW)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.CustomEndCap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap(2.2, 2.4)

  $lx = [float]($S * 0.30)
  $rx = [float]($S * 0.70)
  $g.DrawLine($pen, $lx, [float]($S * 0.37), $rx, [float]($S * 0.37))
  $g.DrawLine($pen, $rx, [float]($S * 0.63), $lx, [float]($S * 0.63))

  $out = Join-Path $outDir ("icon{0}.png" -f $S)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

  $pen.Dispose(); $brush.Dispose(); $path.Dispose(); $g.Dispose(); $bmp.Dispose()
  Write-Output "wrote $out"
}

foreach ($s in 16, 32, 48, 128) { New-Icon $s }
