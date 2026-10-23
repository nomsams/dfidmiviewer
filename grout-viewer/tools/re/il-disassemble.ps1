param([string]$Dll,[string]$Type,[string]$Method='',[switch]$List)
$dir='C:\Program Files (x86)\DLGPVD'
[AppDomain]::CurrentDomain.add_ReflectionOnlyAssemblyResolve({ param($s,$e) try{ [Reflection.Assembly]::ReflectionOnlyLoad($e.Name) }catch{ $n=($e.Name -split ',')[0]; $f=Join-Path $dir "$n.dll"; if(Test-Path $f){[Reflection.Assembly]::ReflectionOnlyLoadFrom($f)} } })
$a=[Reflection.Assembly]::ReflectionOnlyLoadFrom("$dir\$Dll")
$t=$a.GetType($Type)
$bf=[Reflection.BindingFlags]'Public,NonPublic,Instance,Static,DeclaredOnly'
$ms=@($t.GetMethods($bf))+@($t.GetConstructors($bf))
if($List){ $ms | % { $b=$_.GetMethodBody(); "{0}  ({1} bytes)" -f $_.ToString(), $(if($b){$b.GetILAsByteArray().Length}else{0}) }; "FIELDS:"; $t.GetFields($bf)|%{ $_.ToString() }; return }
$ops=@{}; 
foreach($f in [Reflection.Emit.OpCodes].GetFields()){ $o=$f.GetValue($null); if($o -is [Reflection.Emit.OpCode]){ $ops[[int]$o.Value -band 0xFFFF]=$o } }
foreach($m in $ms){ if($m.Name -ne $Method){continue}
  "=== $($m.ToString())"
  $body=$m.GetMethodBody(); $il=$body.GetILAsByteArray(); $mod=$m.Module
  $body.LocalVariables | % { "  local[{0}] {1}" -f $_.LocalIndex,$_.LocalType.Name }
  $i=0
  while($i -lt $il.Length){
    $pos=$i; $v=$il[$i++]; if($v -eq 0xFE){ $v=0xFE00 -bor $il[$i++] }
    $o=$ops[[int]$v]; $arg=''
    switch($o.OperandType.ToString()){
      'InlineNone'{} 'ShortInlineBrTarget'{ $d=$il[$i]; if($d -gt 127){$d-=256}; $i++; $arg="IL_{0:X4}" -f ($i+$d) }
      'InlineBrTarget'{ $d=[BitConverter]::ToInt32($il,$i); $i+=4; $arg="IL_{0:X4}" -f ($i+$d) }
      'ShortInlineI'{ $arg=$il[$i]; if($arg -gt 127){$arg-=256}; $i++ } 'ShortInlineVar'{ $arg=$il[$i]; $i++ }
      'InlineVar'{ $arg=[BitConverter]::ToUInt16($il,$i); $i+=2 }
      'InlineI'{ $arg=[BitConverter]::ToInt32($il,$i); $i+=4 } 'InlineI8'{ $arg=[BitConverter]::ToInt64($il,$i); $i+=8 }
      'ShortInlineR'{ $arg=[BitConverter]::ToSingle($il,$i); $i+=4 } 'InlineR'{ $arg=[BitConverter]::ToDouble($il,$i); $i+=8 }
      'InlineString'{ $tk=[BitConverter]::ToInt32($il,$i); $i+=4; $arg='"'+$mod.ResolveString($tk)+'"' }
      'InlineSwitch'{ $n=[BitConverter]::ToInt32($il,$i); $i+=4; $tg=@(); for($k=0;$k -lt $n;$k++){ $tg+=[BitConverter]::ToInt32($il,$i); $i+=4 }; $arg="switch($n)" }
      default { $tk=[BitConverter]::ToInt32($il,$i); $i+=4; try{ $r=$mod.ResolveMember($tk); $arg=$r.DeclaringType.Name+'::'+$r.Name }catch{ try{$arg=$mod.ResolveType($tk).Name}catch{$arg="tok$tk"} } }
    }
    "IL_{0:X4}: {1} {2}" -f $pos,$o.Name,$arg
  }
}
