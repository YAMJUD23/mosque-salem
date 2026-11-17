import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Heart,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import { ProjectCampaign } from '../types';

interface ParkingDonationSectionProps {
  project: ProjectCampaign;
  onUpdateProject?: (newProject: ProjectCampaign) => void;
}

function parseCotizupHtml(html: string): { currentAmount?: number; donorsCount?: number } {
  const amountMatch =
    html.match(/data-current-amount="([0-9.]+)"/i) ||
    html.match(/class="count-anim"\s+data-to="([0-9.]+)"/i) ||
    html.match(/data-to="([0-9.]+)"/i);
  const donorsMatch =
    html.match(/icon-users-profiles-01-thin[^>]*><\/i>\s*<span>\s*([0-9]+)\s*<\/span>/i) ||
    html.match(/data-total-donors="([0-9]+)"/i) ||
    html.match(/Donateurs\s*\((\d+)\)/i) ||
    html.match(/(\d+)\s*participants/i);

  return {
    currentAmount: amountMatch ? parseFloat(amountMatch[1]) : undefined,
    donorsCount: donorsMatch ? parseInt(donorsMatch[1], 10) : undefined,
  };
}

function parseCotizupReaderText(text: string): { currentAmount?: number; donorsCount?: number } {
  // Format in Jina Reader markdown: "€ 1,452 on €50,000\n\n3%\n\n31\n\n"
  const blockMatch = text.match(/€\s*([0-9,\s.]+)\s*(?:on|sur)\s*€?\s*50[,\s\u00a0]*000[\s\S]{0,60}?%\s+(\d+)/i);
  if (blockMatch) {
    const rawAmt = blockMatch[1].replace(/[,\s\u00a0]/g, '');
    const amt = parseFloat(rawAmt);
    const don = parseInt(blockMatch[2], 10);
    return {
      currentAmount: !Number.isNaN(amt) ? amt : undefined,
      donorsCount: !Number.isNaN(don) ? don : undefined,
    };
  }
  return {};
}

export const ParkingDonationSection: React.FC<ParkingDonationSectionProps> = ({
  project,
  onUpdateProject,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<number | null>(50);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('Synchro temps réel CotizUp active');
  const [syncSuccessToast, setSyncSuccessToast] = useState(false);

  const projectRef = useRef<ProjectCampaign>(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // Real-time sync with CotizUp (works both on local/server via /api/cotizup AND on GitHub Pages in real time)
  const syncWithCotizup = useCallback(async (isManual = false) => {
    setIsRefreshing(true);
    try {
      let liveAmount: number | undefined;
      let liveDonors: number | undefined;
      const ts = Date.now();

      // 1. Try live server endpoint first (/api/cotizup)
      try {
        const apiRes = await fetch(`/api/cotizup?refresh=${isManual ? '1' : '0'}&t=${ts}`, {
          cache: 'no-store',
        });
        const contentType = apiRes.headers.get('content-type') || '';
        if (apiRes.ok && contentType.includes('application/json')) {
          const data = await apiRes.json();
          if (data?.currentAmount) liveAmount = Number(data.currentAmount);
          if (data?.donorsCount) liveDonors = Number(data.donorsCount);
        }
      } catch {
        // Ignore if running on static GitHub Pages
      }

      // 2. If running on static GitHub Pages (or if /api/cotizup was not available), query CotizUp directly in real-time
      if (!liveAmount || !liveDonors) {
        const targetUrl = projectRef.current.cotizupUrl;
        try {
          const jinaHtmlRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
            headers: {
              'X-Return-Format': 'html',
              'X-No-Cache': 'true',
            },
            cache: 'no-store',
          });
          if (jinaHtmlRes.ok) {
            const html = await jinaHtmlRes.text();
            const parsed = parseCotizupHtml(html);
            if (parsed.currentAmount) liveAmount = parsed.currentAmount;
            if (parsed.donorsCount) liveDonors = parsed.donorsCount;
          }
        } catch {
          // Fallback to simple CORS request (no custom headers)
          try {
            const jinaJsonRes = await fetch(`https://r.jina.ai/${targetUrl}?t=${ts}`, {
              headers: { Accept: 'application/json' },
              cache: 'no-store',
            });
            if (jinaJsonRes.ok) {
              const j = await jinaJsonRes.json();
              const parsed = parseCotizupReaderText(j?.data?.content || '');
              if (parsed.currentAmount) liveAmount = parsed.currentAmount;
              if (parsed.donorsCount) liveDonors = parsed.donorsCount;
            }
          } catch {
            // Ignore live proxy error
          }
        }
      }

      // 3. Also check static api/cotizup.json and keep the highest/most up-to-date figures
      try {
        const base = import.meta.env.BASE_URL || '/';
        const cleanBase = base.endsWith('/') ? base : `${base}/`;
        const staticRes = await fetch(`${cleanBase}api/cotizup.json?t=${ts}`, { cache: 'no-store' });
        if (staticRes.ok) {
          const staticData = await staticRes.json();
          const stAmount = Number(staticData?.currentAmount) || 0;
          const stDonors = Number(staticData?.donorsCount) || 0;
          if (!liveAmount || stAmount > liveAmount) liveAmount = stAmount;
          if (!liveDonors || stDonors > liveDonors) liveDonors = stDonors;
        }
      } catch {
        // Ignore static fallback error
      }

      if ((liveAmount || liveDonors) && onUpdateProject) {
        const currentProj = projectRef.current;
        const nextAmount = liveAmount && liveAmount > 0 ? liveAmount : currentProj.currentAmount;
        const nextDonors = liveDonors && liveDonors > 0 ? liveDonors : currentProj.donorsCount;

        if (nextAmount !== currentProj.currentAmount || nextDonors !== currentProj.donorsCount) {
          onUpdateProject({
            ...currentProj,
            currentAmount: nextAmount,
            donorsCount: nextDonors,
          });
        }
      }

      const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setSyncStatus(`Synchronisé en direct avec CotizUp à ${now}`);
      if (isManual) {
        setSyncSuccessToast(true);
        setTimeout(() => setSyncSuccessToast(false), 3000);
      }
    } catch {
      setSyncStatus('Synchronisé avec CotizUp');
    } finally {
      setIsRefreshing(false);
    }
  }, [onUpdateProject]);

  // Auto-sync on mount, every 20 seconds, and immediately when returning from the CotizUp tab
  useEffect(() => {
    syncWithCotizup(false);
    const interval = setInterval(() => {
      syncWithCotizup(false);
    }, 20000);

    const handleFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        syncWithCotizup(false);
      }
    };

    window.addEventListener('focus', handleFocusOrVisible);
    document.addEventListener('visibilitychange', handleFocusOrVisible);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocusOrVisible);
      document.removeEventListener('visibilitychange', handleFocusOrVisible);
    };
  }, [syncWithCotizup]);

  // Exact percentage calculation based on real amounts (1 452 € / 50 000 €)
  const percentage = Math.max(
    1,
    Math.round((project.currentAmount / project.targetAmount) * 100 * 10) / 10
  );

  // Clean presets requested: 10 €, 50 €, 100 €, 250 €
  const presets = [10, 50, 100, 250];

  return (
    <section id="projet-parking" className="py-14 sm:py-20 bg-[#0A261A] text-white relative overflow-hidden">
      {/* Decorative ambient glow */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-emerald-700/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto space-y-3 mb-10 sm:mb-12">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-widest text-amber-300 uppercase">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Grand Projet Communautaire · Parking Sécurisé</span>
          </div>

          <h2 className="font-editorial text-3xl sm:text-5xl font-bold text-white leading-tight">
            Soutenez le projet du parking
          </h2>

          <p className="text-emerald-100/90 text-sm sm:text-lg leading-relaxed">
            Votre contribution aide à financer le projet de stationnement et de voirie de la Mosquée SALEM. Chaque don s'actualise automatiquement en temps réel depuis CotizUp.
          </p>
        </div>

        {/* Main Campaign Card */}
        <div className="max-w-4xl mx-auto bg-[#0F3524] rounded-3xl p-6 sm:p-10 border border-emerald-700/60 shadow-2xl space-y-7">
          
          {/* Progress Tracker with Real Figures & Live Auto-Sync Button */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-200">
                    Montant collecté en direct sur CotizUp
                  </span>
                  <button
                    onClick={() => syncWithCotizup(true)}
                    disabled={isRefreshing}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-900 hover:bg-emerald-800 text-[11px] font-semibold text-amber-300 border border-emerald-700/80 transition-all cursor-pointer shadow-2xs hover:border-amber-400/50"
                    title="Actualiser instantanément avec CotizUp sans mot de passe"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
                    <span>Actualiser</span>
                  </button>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="font-editorial text-3xl sm:text-5xl font-bold text-amber-300 tabular-nums">
                    {project.currentAmount.toLocaleString('fr-FR')} €
                  </span>
                  <span className="text-sm sm:text-base text-emerald-200/80">
                    sur un objectif de {project.targetAmount.toLocaleString('fr-FR')} €
                  </span>
                </div>
              </div>

              <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-1.5">
                <span className="text-xs sm:text-sm font-bold text-white bg-emerald-900/90 px-3 py-1 rounded-full border border-emerald-700">
                  {project.donorsCount} donateurs
                </span>
                <span className="text-xs text-amber-300/90 font-medium">
                  {percentage}% de l'objectif atteint
                </span>
              </div>
            </div>

            {/* Sync feedback notification */}
            <div className="flex items-center justify-between text-[11px] text-emerald-200/70 pt-1">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>{syncStatus}</span>
              </span>
              {syncSuccessToast && (
                <span className="text-amber-300 font-semibold flex items-center gap-1 animate-in fade-in duration-200">
                  <CheckCircle2 className="w-3 h-3 text-amber-400" />
                  <span>Montant et donateurs synchronisés avec CotizUp !</span>
                </span>
              )}
            </div>

            {/* Visual Progress Bar */}
            <div className="w-full h-4 bg-emerald-950/80 rounded-full overflow-hidden p-0.5 border border-emerald-800/80 shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-1000 shadow-sm"
                style={{ width: `${Math.min(100, percentage)}%` }}
              />
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="space-y-3 pt-2">
            <div className="text-xs font-semibold text-emerald-100/90 uppercase tracking-wider">
              Choisissez votre montant de contribution :
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              {presets.map((amount) => {
                const isSelected = selectedPreset === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setSelectedPreset(amount)}
                    className={`py-3 sm:py-3.5 rounded-2xl font-bold text-base sm:text-lg transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-amber-400 text-emerald-950 border-amber-300 shadow-md ring-2 ring-amber-400/40 transform -translate-y-0.5'
                        : 'bg-emerald-900/40 text-white border-emerald-700/60 hover:bg-emerald-900/80 hover:border-emerald-600'
                    }`}
                  >
                    {amount} €
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary CTA Direct to CotizUp with Selected Amount */}
          <div className="space-y-3 pt-3">
            <a
              href={`${project.cotizupUrl}${selectedPreset ? `?amount=${selectedPreset}` : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-3 py-4 sm:py-4.5 px-6 rounded-2xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-bold text-base sm:text-lg transition-all shadow-xl transform active:scale-98 cursor-pointer group"
            >
              <Heart className="w-5 h-5 fill-emerald-950 group-hover:scale-110 transition-transform" />
              <span>Participer avec {selectedPreset ? `${selectedPreset} €` : 'mon don'} sur CotizUp</span>
              <ArrowRight className="w-5 h-5 text-emerald-950 group-hover:translate-x-1 transition-transform" />
            </a>

            <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-emerald-200/80 gap-2 px-1">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Paiement 100% sécurisé via CotizUp · Reçu fiscal délivrable</span>
              </div>
              <a
                href={project.cotizupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white inline-flex items-center gap-1"
              >
                <span>Voir la page officielle de la cagnotte</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* 4 Execution Phases */}
          <div className="pt-6 border-t border-emerald-800/80 space-y-4">
            <div className="text-xs font-semibold text-emerald-200 uppercase tracking-wider">
              Étapes d'aménagement du parking
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {project.phases.map((phase) => (
                <div
                  key={phase.number}
                  className={`p-3.5 rounded-2xl border ${
                    phase.status === 'termine'
                      ? 'bg-emerald-900/60 border-emerald-600/70 text-emerald-100'
                      : phase.status === 'en_cours'
                      ? 'bg-amber-400/10 border-amber-400/60 text-white'
                      : 'bg-emerald-950/40 border-emerald-800/40 text-emerald-200/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-bold text-amber-400">
                      Phase {phase.number}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        phase.status === 'termine'
                          ? 'bg-emerald-700 text-white'
                          : phase.status === 'en_cours'
                          ? 'bg-amber-400 text-emerald-950'
                          : 'bg-emerald-900/60 text-emerald-300'
                      }`}
                    >
                      {phase.status === 'termine'
                        ? 'Validé'
                        : phase.status === 'en_cours'
                        ? 'En cours'
                        : 'À venir'}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white leading-snug">
                    {phase.title}
                  </h4>
                  <p className="text-[11px] text-emerald-100/70 mt-1 leading-relaxed">
                    {phase.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
};
