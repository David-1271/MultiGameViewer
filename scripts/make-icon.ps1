# Generates assets/icon.png (256x256): a 2x2 grid of "screens". Run once; output is committed.
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
function RoundRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $r, $r, 180, 90); $p.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
  $p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90); $p.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
  $p.CloseFigure(); return $p
}
$g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 20, 22, 27))), (RoundRect 8 8 240 240 56))
$colors = @(@(61, 139, 253), @(62, 207, 142), @(240, 180, 41), @(242, 95, 92))
$cell = 96; $gap = 12; $origin = 26
for ($i = 0; $i -lt 4; $i++) {
  $x = $origin + ($i % 2) * ($cell + $gap); $y = $origin + [math]::Floor($i / 2) * ($cell + $gap)
  $c = $colors[$i]
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $c[0], $c[1], $c[2]))), (RoundRect $x $y $cell $cell 22))
}
$out = Join-Path $PSScriptRoot '..\assets\icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
"wrote $out"
