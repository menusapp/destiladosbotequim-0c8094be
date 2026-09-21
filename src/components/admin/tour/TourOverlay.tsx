/**
 * Overlay visual do tour guiado contínuo.
 *
 * - Destaca o elemento alvo com um anel laranja fino + glow suave (sem
 *   escurecer a tela).
 * - Card flutuante posiciona-se de forma adaptativa (top/bottom/left/right
 *   ou centralizado quando não há target).
 * - Recalcula posição em mudanças de passo, resize, scroll e mutações de
 *   layout. Usa retries (60ms / 200ms / 400ms) para cobrir trocas de aba.
 * - ESC encerra; setas ←/→ navegam.
 * - Botão muda para "Concluir" apenas no último passo da última aba do tour.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTour } from "./TourContext";
import { getStepsForSection } from "./tourSteps";
import type { TourPlacement } from "./types";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 6;
const CARD_WIDTH = 340;
const CARD_GAP = 16;
const RING_COLOR = "#184a2d"; // verde da marca

function getRectFromTarget(target?: string): Rect | null {
  if (!target) return null;
  try {
    const el = document.querySelector(target) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  } catch {
    return null;
  }
}

function computeCardPosition(rect: Rect | null, placement: TourPlacement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!rect || placement === "center") {
    return {
      top: Math.max(20, vh / 2 - 120),
      left: Math.max(20, vw / 2 - CARD_WIDTH / 2),
    };
  }

  let top = 0;
  let left = 0;
  const cardEstHeight = 200;

  switch (placement) {
    case "top":
      top = rect.top - cardEstHeight - CARD_GAP;
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      break;
    case "bottom":
      top = rect.top + rect.height + CARD_GAP;
      left = rect.left + rect.width / 2 - CARD_WIDTH / 2;
      break;
    case "left":
      top = rect.top + rect.height / 2 - cardEstHeight / 2;
      left = rect.left - CARD_WIDTH - CARD_GAP;
      break;
    case "right":
      top = rect.top + rect.height / 2 - cardEstHeight / 2;
      left = rect.left + rect.width + CARD_GAP;
      break;
  }

  if (top < 16) top = Math.min(rect.top + rect.height + CARD_GAP, vh - cardEstHeight - 16);
  if (top + cardEstHeight > vh - 16) top = Math.max(16, rect.top - cardEstHeight - CARD_GAP);
  if (left < 16) left = 16;
  if (left + CARD_WIDTH > vw - 16) left = vw - CARD_WIDTH - 16;

  return { top, left };
}

export function TourOverlay() {
  const {
    activeSectionId,
    stepIndex,
    nextStep,
    prevStep,
    endTour,
    isFinalStep,
    isFirstStep,
  } = useTour();
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const steps = useMemo(
    () => (activeSectionId ? getStepsForSection(activeSectionId) : []),
    [activeSectionId],
  );
  const step = steps[stepIndex];

  // Recalcula posição do alvo (com retries para cobrir trocas de aba)
  useLayoutEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    const update = () => setRect(getRectFromTarget(step.target));

    update();
    const t1 = window.setTimeout(update, 60);
    const t2 = window.setTimeout(update, 200);
    const t3 = window.setTimeout(update, 400);
    const t4 = window.setTimeout(update, 700);

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const ro = new ResizeObserver(update);
    ro.observe(document.body);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      ro.disconnect();
    };
  }, [step, activeSectionId]);

  // Bring target into view
  useEffect(() => {
    if (!step?.target) return;
    const tryScroll = () => {
      const el = document.querySelector(step.target!) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    const t = window.setTimeout(tryScroll, 250);
    return () => window.clearTimeout(t);
  }, [step]);

  // Atalhos de teclado
  useEffect(() => {
    if (!activeSectionId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") endTour();
      else if (e.key === "ArrowRight") nextStep();
      else if (e.key === "ArrowLeft") prevStep();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSectionId, endTour, nextStep, prevStep]);

  if (!activeSectionId || !step) return null;

  const placement: TourPlacement = step.placement ?? (rect ? "bottom" : "center");
  const cardPos = computeCardPosition(rect, placement);

  // Anel laranja sobre o target
  const ringStyle: React.CSSProperties | null = rect
    ? {
        position: "fixed",
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
        borderRadius: 10,
        border: `2px solid ${RING_COLOR}`,
        boxShadow: `0 0 0 4px ${RING_COLOR}2E, 0 0 16px ${RING_COLOR}4D`,
        pointerEvents: "none",
        zIndex: 9998,
        transition: "top 220ms ease-out, left 220ms ease-out, width 220ms ease-out, height 220ms ease-out",
        animation: "tourRingPulse 1.8s ease-in-out infinite",
      }
    : null;

  const cardStyle: React.CSSProperties = {
    position: "fixed",
    top: cardPos.top,
    left: cardPos.left,
    width: CARD_WIDTH,
    zIndex: 9999,
    transition: "top 220ms ease-out, left 220ms ease-out",
  };

  return createPortal(
    <>
      {/* Keyframes inline (evita poluir o CSS global por uma feature pontual) */}
      <style>{`
        @keyframes tourRingPulse {
          0%, 100% { box-shadow: 0 0 0 4px ${RING_COLOR}2E, 0 0 16px ${RING_COLOR}4D; }
          50%      { box-shadow: 0 0 0 7px ${RING_COLOR}1F, 0 0 22px ${RING_COLOR}66; }
        }
      `}</style>

      {/* Anel laranja */}
      {ringStyle && <div style={ringStyle} aria-hidden />}

      {/* Card flutuante */}
      <div
        ref={cardRef}
        style={cardStyle}
        className="rounded-xl border border-border bg-card text-card-foreground shadow-2xl ring-1"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
      >
        {/* Faixa laranja superior — conecta visualmente com o anel */}
        <div className="h-1 w-full rounded-t-xl" style={{ backgroundColor: RING_COLOR }} />

        {/* Header */}
        <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: RING_COLOR }}>
              Tour · Passo {stepIndex + 1} de {steps.length}
            </p>
            <h3 id="tour-step-title" className="mt-1 text-base font-semibold leading-tight">
              {step.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={endTour}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Fechar tour"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 pb-3">
          <p className="text-sm leading-relaxed text-muted-foreground">{step.content}</p>
        </div>

        {/* Progress bar */}
        <div className="px-4 pb-3">
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${((stepIndex + 1) / steps.length) * 100}%`,
                backgroundColor: RING_COLOR,
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={endTour}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Pular tour
          </Button>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={prevStep}
              disabled={isFirstStep}
              className="h-8 px-2.5"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Anterior
            </Button>
            <Button
              size="sm"
              onClick={nextStep}
              className="h-8 px-3 text-white"
              style={{ backgroundColor: RING_COLOR }}
            >
              {isFinalStep ? "Concluir" : "Próximo"}
              {!isFinalStep && <ChevronRight className="h-3.5 w-3.5 ml-0.5" />}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
