export const PRESENTATION_CSS = `
.presentation {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  justify-content: flex-end; gap: clamp(.7rem, 1.8vh, 1.4rem);
  padding: clamp(2rem, 7vw, 6rem); overflow: hidden;
  color: #fff; background: linear-gradient(to top, rgba(0,0,0,.92), rgba(0,0,0,.58) 45%, transparent 76%);
  opacity: 1; transition: opacity 420ms ease-out;
}
.presentation--aborting { opacity: 0; }
.presentation__line { margin: 0; max-width: 19ch; font: 700 clamp(2rem, 5.3vw, 5.8rem)/1.03 Arial, sans-serif; text-wrap: balance; }
.presentation__line--prior { opacity: .4; }
.presentation__line--current { opacity: 1; }
.presentation__line--preroll { font-size: clamp(1.6rem, 4vw, 4rem); }
`;

export function installPresentationStyles(documentValue: Document = document): () => void {
  const style = documentValue.createElement("style");
  style.dataset.mirrormirror = "presentation";
  style.textContent = PRESENTATION_CSS;
  documentValue.head.append(style);
  return () => style.remove();
}
