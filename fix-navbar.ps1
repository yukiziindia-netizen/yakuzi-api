$content = Get-Content -Path 'd:\Projects\Yakuzi\yakuzi-web\apps\buyer\src\components\landing\Navbar.tsx'
$before = $content[0..616]
$after = $content[1031..($content.Length-1)]
$result = $before + $after
$result | Set-Content -Path 'd:\Projects\Yakuzi\yakuzi-web\apps\buyer\src\components\landing\Navbar.tsx' -Encoding UTF8
Write-Host "Done. Lines before: $($content.Length), Lines after: $($result.Length)"
