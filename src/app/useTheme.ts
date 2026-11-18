import { useEffect, useLayoutEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export function useTheme(theme: Theme) {
  const [systemDark,setSystemDark]=useState(()=>window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-color-scheme: dark)');
    const update=()=>setSystemDark(media.matches);
    update();
    media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[]);
  const resolved=theme==='system'?(systemDark?'dark':'light'):theme;
  useLayoutEffect(()=>{
    document.documentElement.dataset.theme=resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',resolved==='dark'?'#1e231e':'#f8f7f2');
  },[resolved]);
  return resolved;
}
