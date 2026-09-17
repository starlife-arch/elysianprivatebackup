import { icon } from './icons.js';
export function openSheet({label='Dialog', content='', className=''}) {
  const priorFocus=document.activeElement, overlay=document.createElement('div');
  overlay.className=`dv-sheet-overlay ${className}`;
  overlay.innerHTML=`<section class="dv-sheet" role="dialog" aria-modal="true" aria-label="${label}" tabindex="-1"><button class="dv-sheet-close" aria-label="Close">${icon('close',{size:22})}</button><div class="dv-sheet-content">${content}</div></section>`;
  const close=()=>{overlay.classList.remove('open'); document.body.classList.remove('sheet-open'); setTimeout(()=>overlay.remove(),220); priorFocus?.focus?.(); document.removeEventListener('keydown',key);};
  const key=e=>{if(e.key==='Escape') close(); if(e.key==='Tab'){const focus=[...overlay.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled); if(!focus.length)return; const i=focus.indexOf(document.activeElement); if(e.shiftKey && i<=0){e.preventDefault();focus.at(-1).focus()} else if(!e.shiftKey&&i===focus.length-1){e.preventDefault();focus[0].focus()}}};
  overlay.addEventListener('click',e=>{if(e.target===overlay)close()}); overlay.querySelector('.dv-sheet-close').onclick=close; document.addEventListener('keydown',key); document.body.append(overlay); requestAnimationFrame(()=>overlay.classList.add('open')); overlay.querySelector('.dv-sheet').focus(); document.body.classList.add('sheet-open'); return {element:overlay,close};
}
