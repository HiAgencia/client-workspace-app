import type Lenis from "lenis";


let smooth: Lenis | null = null;

export function setSmoothScroll(lenis: Lenis | null): void {
  smooth = lenis;
}



const HOLDING_LAYER = "dialog:modal, .positioner[data-open]";

export function pageHeld(): boolean {
  return document.querySelector(HOLDING_LAYER) !== null;
}




function driving(): Lenis | null {
  if (!smooth || smooth.isStopped) return null;
  smooth.dimensions.resize();
  return smooth;
}


export function scrollPageTo(top: number, instant = false): void {
  const lenis = driving();
  if (lenis) lenis.scrollTo(top, { immediate: instant });
  else window.scrollTo({ top, behavior: instant ? "instant" : "smooth" });
}




export function scrollPlaceIntoView(element: Element, block: ScrollLogicalPosition, instant = false): void {
  const lenis = driving();
  if (!lenis) return element.scrollIntoView({ block, inline: "nearest", behavior: instant ? "instant" : "smooth" });
  const from = window.scrollY;
  element.scrollIntoView({ block, inline: "nearest", behavior: "instant" });
  const to = window.scrollY;
  window.scrollTo({ top: from, behavior: "instant" });
  lenis.scrollTo(to, { immediate: instant });
}
