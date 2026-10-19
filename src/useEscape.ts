import { useEffect, useRef } from 'react';

// Esc schließt immer nur den obersten Dialog: jeder offene Dialog legt
// seinen Handler auf einen Stapel, der Tastendruck geht an den letzten.
const stack: { current: () => void }[] = [];
let installed = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || stack.length === 0) return;
  // Das Handbuch liegt über allem und schließt sich selbst.
  if (document.querySelector('.hlp-overlay')) return;
  e.preventDefault();
  e.stopPropagation();
  stack[stack.length - 1].current();
}

export function useEscape(handler: () => void, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    if (!installed) {
      window.addEventListener('keydown', onKey, true);
      installed = true;
    }
    const entry = ref;
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
