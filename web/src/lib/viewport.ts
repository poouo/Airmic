/** Track the visible area when a mobile keyboard resizes or pans only the visual viewport. */
export function syncVisualViewport(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => undefined;
  const style = document.documentElement.style;
  const clear = () => {
    style.removeProperty("--visible-height");
    style.removeProperty("--visible-top");
  };
  const update = () => {
    if (Math.abs(viewport.scale - 1) > 0.01) {
      clear();
      return;
    }
    style.setProperty("--visible-height", `${Math.floor(viewport.height)}px`);
    style.setProperty("--visible-top", `${Math.max(0, Math.round(viewport.offsetTop))}px`);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    clear();
  };
}
