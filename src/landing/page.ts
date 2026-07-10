import type { Settings } from "../config";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderLandingPage(settings: Settings): string {
  const telegramUrl = escapeHtml(settings.telegramBotUrl || "#");
  const lineUrl = escapeHtml(settings.lineAddUrl || "#");
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Arnold — your nutrition coach in Telegram &amp; LINE</title>
  <meta name="description" content="Snap a food photo or text what you ate. Arnold estimates calories and macros, tracks your day, and coaches you — right in chat. No app download." />
  <meta name="theme-color" content="#FAF9F6" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            display: ['Fraunces', 'Georgia', 'serif'],
            sans: ['DM Sans', 'system-ui', 'sans-serif'],
          },
          colors: {
            cream: '#FAF9F6',
            sand: '#F3F1EC',
            ink: '#1A1917',
            muted: '#6B6760',
            accent: '#2D6A4F',
            'accent-light': '#D8F3DC',
            telegram: '#2AABEE',
            line: '#06C755',
          },
        },
      },
    };
  </script>
  <style>
    html { scroll-behavior: smooth; }
    .gradient-hero {
      background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(45,106,79,0.12), transparent),
                  radial-gradient(ellipse 50% 40% at 90% 20%, rgba(45,106,79,0.06), transparent),
                  #FAF9F6;
    }
    .phone-shadow { box-shadow: 0 25px 60px -12px rgba(26,25,23,0.18), 0 0 0 1px rgba(26,25,23,0.06); }
    .bubble-user { background: #2AABEE; color: white; border-radius: 18px 18px 4px 18px; }
    .bubble-bot { background: white; color: #1A1917; border-radius: 18px 18px 18px 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
    .bubble-line-user { background: #06C755; color: white; border-radius: 18px 18px 4px 18px; }
    .pricing-card { transition: transform 0.2s, box-shadow 0.2s; }
    .pricing-card:hover { transform: translateY(-2px); box-shadow: 0 20px 40px -12px rgba(26,25,23,0.12); }
  </style>
</head>
<body class="font-sans text-ink bg-cream antialiased">

  <!-- Nav -->
  <header class="fixed top-0 inset-x-0 z-50 bg-cream/80 backdrop-blur-md border-b border-ink/5">
    <div class="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
      <a href="/" class="font-display text-xl font-semibold tracking-tight">Arnold</a>
      <nav class="hidden sm:flex items-center gap-8 text-sm text-muted">
        <a href="#demo" class="hover:text-ink transition">See it in action</a>
        <a href="#how" class="hover:text-ink transition">How it works</a>
        <a href="#pricing" class="hover:text-ink transition">Pricing</a>
      </nav>
      <div class="flex items-center gap-2">
        <a href="${telegramUrl}" class="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-telegram text-white text-sm font-medium hover:opacity-90 transition">Telegram</a>
        <a href="${lineUrl}" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-line text-white text-sm font-medium hover:opacity-90 transition">LINE</a>
      </div>
    </div>
  </header>

  <!-- Hero -->
  <section class="gradient-hero pt-32 pb-20 px-5">
    <div class="max-w-6xl mx-auto text-center">
      <p class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-light text-accent text-sm font-medium mb-8">
        <span class="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
        AI nutrition coach — lives in your chat
      </p>
      <h1 class="font-display text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.1] max-w-3xl mx-auto">
        Track what you eat.<br class="hidden sm:block" />
        <span class="text-accent">Just text Arnold.</span>
      </h1>
      <p class="mt-6 text-lg sm:text-xl text-muted max-w-2xl mx-auto leading-relaxed">
        Send a food photo or describe your meal in plain English. Get calories, protein, carbs, and fat — then log it with one tap. No app. No signup forms.
      </p>
      <div class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
        <a href="${telegramUrl}" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-ink text-white font-medium hover:bg-ink/90 transition">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/></svg>
          Open in Telegram
        </a>
        <a href="${lineUrl}" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full border-2 border-ink/10 text-ink font-medium hover:border-ink/20 transition">
          Open in LINE
        </a>
      </div>
      <p class="mt-6 text-sm text-muted">Free to use. Works on iOS &amp; Android.</p>
    </div>
  </section>

  <!-- Chat demo -->
  <section id="demo" class="py-24 px-5 bg-sand">
    <div class="max-w-6xl mx-auto">
      <div class="text-center mb-16">
        <h2 class="font-display text-3xl sm:text-4xl font-semibold tracking-tight">See it in action</h2>
        <p class="mt-4 text-muted text-lg max-w-xl mx-auto">Text Arnold like you'd text a friend. Photos, meals, progress — all in one thread.</p>
      </div>

      <div class="grid md:grid-cols-2 gap-8 lg:gap-12">
        <!-- Telegram mock: photo flow -->
        <div>
          <p class="text-sm font-medium text-muted mb-4 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-telegram"></span>
            Photo → instant estimate
          </p>
          <div class="phone-shadow rounded-[2rem] bg-[#17212B] p-3 max-w-sm mx-auto">
            <div class="rounded-[1.5rem] overflow-hidden bg-[#0E1621]">
              <div class="px-4 py-3 flex items-center gap-3 border-b border-white/5">
                <div class="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white text-sm font-bold">A</div>
                <div>
                  <p class="text-white text-sm font-medium">Arnold</p>
                  <p class="text-white/40 text-xs">bot</p>
                </div>
              </div>
              <div class="p-4 space-y-3 min-h-[420px]">
                <div class="flex justify-end">
                  <div class="bubble-user px-4 py-2.5 max-w-[75%] text-sm">
                    <div class="w-40 h-28 rounded-lg bg-gradient-to-br from-amber-100 to-amber-200 mb-1.5 flex items-center justify-center text-amber-800/40 text-xs">food photo</div>
                  </div>
                </div>
                <div class="flex justify-start">
                  <div class="bubble-bot px-4 py-3 max-w-[85%] text-sm leading-relaxed">
                    rice + chicken stir-fry + vegetables — ~620 kcal (P38 C72 F18). tap to log or adjust.
                    <div class="flex flex-wrap gap-1.5 mt-3">
                      <span class="px-3 py-1 rounded-full bg-accent text-white text-xs font-medium">Log</span>
                      <span class="px-3 py-1 rounded-full bg-gray-100 text-xs">Smaller</span>
                      <span class="px-3 py-1 rounded-full bg-gray-100 text-xs">Bigger</span>
                      <span class="px-3 py-1 rounded-full bg-gray-100 text-xs">Skip</span>
                    </div>
                  </div>
                </div>
                <div class="flex justify-end">
                  <div class="bubble-user px-4 py-2.5 text-sm">Log</div>
                </div>
                <div class="flex justify-start">
                  <div class="bubble-bot px-4 py-2.5 max-w-[85%] text-sm">
                    logged lunch — 620 kcal, P38g C72g F18g
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- LINE mock: text flow -->
        <div>
          <p class="text-sm font-medium text-muted mb-4 flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-line"></span>
            Text a meal → coach replies
          </p>
          <div class="phone-shadow rounded-[2rem] bg-white p-3 max-w-sm mx-auto">
            <div class="rounded-[1.5rem] overflow-hidden bg-[#8CABD9]/20">
              <div class="px-4 py-3 flex items-center gap-3 bg-white border-b border-gray-100">
                <div class="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white text-sm font-bold">A</div>
                <div>
                  <p class="text-ink text-sm font-medium">Arnold</p>
                  <p class="text-muted text-xs">Official Account</p>
                </div>
              </div>
              <div class="p-4 space-y-3 min-h-[420px] bg-[#8CABD9]/10">
                <div class="flex justify-end">
                  <div class="bubble-line-user px-4 py-2.5 max-w-[80%] text-sm">
                    had a bowl of oatmeal with banana and peanut butter for breakfast
                  </div>
                </div>
                <div class="flex justify-start">
                  <div class="bubble-bot px-4 py-2.5 max-w-[85%] text-sm leading-relaxed">
                    logged oatmeal bowl with banana &amp; pb — ~485 kcal
                  </div>
                </div>
                <div class="flex justify-end">
                  <div class="bubble-line-user px-4 py-2.5 text-sm">/progress</div>
                </div>
                <div class="flex justify-start">
                  <div class="bubble-bot px-4 py-2.5 max-w-[85%] text-sm leading-relaxed">
                    today: 485 kcal, P18g C62g F20g, 1 meal(s)
                  </div>
                </div>
                <div class="flex justify-end">
                  <div class="bubble-line-user px-4 py-2.5 max-w-[80%] text-sm">
                    am i on track for cutting?
                  </div>
                </div>
                <div class="flex justify-start">
                  <div class="bubble-bot px-4 py-2.5 max-w-[85%] text-sm leading-relaxed">
                    solid start. you're at 485 kcal with good protein. aim for 3-4 more meals today depending on your target.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- How it works -->
  <section id="how" class="py-24 px-5">
    <div class="max-w-6xl mx-auto">
      <div class="text-center mb-16">
        <h2 class="font-display text-3xl sm:text-4xl font-semibold tracking-tight">How it works</h2>
        <p class="mt-4 text-muted text-lg">Three steps. Zero friction.</p>
      </div>
      <div class="grid sm:grid-cols-3 gap-8">
        <div class="text-center p-6">
          <div class="w-14 h-14 rounded-2xl bg-accent-light text-accent flex items-center justify-center text-2xl font-display font-semibold mx-auto mb-5">1</div>
          <h3 class="font-display text-xl font-semibold mb-2">Add Arnold</h3>
          <p class="text-muted leading-relaxed">Open Telegram or LINE and start a chat. No account creation, no email verification.</p>
        </div>
        <div class="text-center p-6">
          <div class="w-14 h-14 rounded-2xl bg-accent-light text-accent flex items-center justify-center text-2xl font-display font-semibold mx-auto mb-5">2</div>
          <h3 class="font-display text-xl font-semibold mb-2">Send food</h3>
          <p class="text-muted leading-relaxed">Snap a photo or type what you ate. Arnold identifies items and estimates calories and macros.</p>
        </div>
        <div class="text-center p-6">
          <div class="w-14 h-14 rounded-2xl bg-accent-light text-accent flex items-center justify-center text-2xl font-display font-semibold mx-auto mb-5">3</div>
          <h3 class="font-display text-xl font-semibold mb-2">Log &amp; track</h3>
          <p class="text-muted leading-relaxed">Tap to confirm, adjust portion size, or skip. Ask for today's progress anytime with /progress.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="py-24 px-5 bg-sand">
    <div class="max-w-6xl mx-auto">
      <div class="grid md:grid-cols-2 gap-12 items-center">
        <div>
          <h2 class="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Built for real life,<br />not spreadsheets</h2>
          <p class="mt-4 text-muted text-lg leading-relaxed">Most people quit calorie tracking because logging is tedious. Arnold meets you where you already are — in your messaging app.</p>
          <ul class="mt-8 space-y-4">
            <li class="flex items-start gap-3">
              <span class="mt-1 w-5 h-5 rounded-full bg-accent-light text-accent flex items-center justify-center text-xs shrink-0">✓</span>
              <span><strong class="font-medium">Photo analysis</strong> — AI vision identifies your meal and estimates nutrition</span>
            </li>
            <li class="flex items-start gap-3">
              <span class="mt-1 w-5 h-5 rounded-full bg-accent-light text-accent flex items-center justify-center text-xs shrink-0">✓</span>
              <span><strong class="font-medium">Text logging</strong> — describe food naturally, Arnold extracts and saves it</span>
            </li>
            <li class="flex items-start gap-3">
              <span class="mt-1 w-5 h-5 rounded-full bg-accent-light text-accent flex items-center justify-center text-xs shrink-0">✓</span>
              <span><strong class="font-medium">Portion learning</strong> — Smaller/Bigger buttons teach your usual serving size</span>
            </li>
            <li class="flex items-start gap-3">
              <span class="mt-1 w-5 h-5 rounded-full bg-accent-light text-accent flex items-center justify-center text-xs shrink-0">✓</span>
              <span><strong class="font-medium">Daily coaching</strong> — ask questions, get progress, stay accountable</span>
            </li>
          </ul>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="p-6 rounded-2xl bg-white border border-ink/5">
            <p class="text-3xl font-display font-semibold text-accent">~3s</p>
            <p class="text-sm text-muted mt-1">photo to estimate</p>
          </div>
          <div class="p-6 rounded-2xl bg-white border border-ink/5">
            <p class="text-3xl font-display font-semibold text-accent">0</p>
            <p class="text-sm text-muted mt-1">apps to install</p>
          </div>
          <div class="p-6 rounded-2xl bg-white border border-ink/5">
            <p class="text-3xl font-display font-semibold text-accent">P/C/F</p>
            <p class="text-sm text-muted mt-1">full macro breakdown</p>
          </div>
          <div class="p-6 rounded-2xl bg-white border border-ink/5">
            <p class="text-3xl font-display font-semibold text-accent">24/7</p>
            <p class="text-sm text-muted mt-1">always in your pocket</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Pricing -->
  <section id="pricing" class="py-24 px-5">
    <div class="max-w-6xl mx-auto">
      <div class="text-center mb-16">
        <h2 class="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Simple pricing</h2>
        <p class="mt-4 text-muted text-lg">Start free. No credit card. No trial that expires.</p>
      </div>
      <div class="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <div class="pricing-card p-8 rounded-3xl border-2 border-accent bg-white relative">
          <div class="absolute -top-3 left-6 px-3 py-0.5 rounded-full bg-accent text-white text-xs font-medium">Current</div>
          <h3 class="font-display text-2xl font-semibold">Free</h3>
          <p class="mt-2 text-muted">Everything you need to start tracking</p>
          <p class="mt-6"><span class="font-display text-5xl font-semibold">$0</span></p>
          <ul class="mt-8 space-y-3 text-sm">
            <li class="flex items-center gap-2"><span class="text-accent">✓</span> Unlimited food photos</li>
            <li class="flex items-center gap-2"><span class="text-accent">✓</span> Text meal logging</li>
            <li class="flex items-center gap-2"><span class="text-accent">✓</span> Daily progress (/progress)</li>
            <li class="flex items-center gap-2"><span class="text-accent">✓</span> AI coaching chat</li>
            <li class="flex items-center gap-2"><span class="text-accent">✓</span> Telegram &amp; LINE</li>
          </ul>
          <a href="${telegramUrl}" class="mt-8 w-full inline-flex items-center justify-center px-6 py-3.5 rounded-full bg-accent text-white font-medium hover:opacity-90 transition">Get started free</a>
        </div>
        <div class="pricing-card p-8 rounded-3xl border border-ink/10 bg-sand/50">
          <h3 class="font-display text-2xl font-semibold">Pro</h3>
          <p class="mt-2 text-muted">Coming soon</p>
          <p class="mt-6"><span class="font-display text-5xl font-semibold text-muted/40">—</span></p>
          <ul class="mt-8 space-y-3 text-sm text-muted">
            <li class="flex items-center gap-2"><span>○</span> Weekly PDF reports</li>
            <li class="flex items-center gap-2"><span>○</span> Proactive check-ins</li>
            <li class="flex items-center gap-2"><span>○</span> FatSecret integration</li>
            <li class="flex items-center gap-2"><span>○</span> Custom goals &amp; targets</li>
          </ul>
          <button disabled class="mt-8 w-full inline-flex items-center justify-center px-6 py-3.5 rounded-full border border-ink/10 text-muted font-medium cursor-not-allowed">Notify me</button>
        </div>
      </div>
    </div>
  </section>

  <!-- Final CTA -->
  <section class="py-24 px-5 bg-ink text-white">
    <div class="max-w-3xl mx-auto text-center">
      <h2 class="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Your coach is one message away</h2>
      <p class="mt-4 text-white/60 text-lg">Add Arnold on Telegram or LINE and send your first food photo today.</p>
      <div class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
        <a href="${telegramUrl}" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-telegram text-white font-medium hover:opacity-90 transition">Open Telegram</a>
        <a href="${lineUrl}" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full bg-line text-white font-medium hover:opacity-90 transition">Open LINE</a>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-10 px-5 border-t border-ink/5">
    <div class="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
      <p class="font-display font-semibold text-ink">Arnold</p>
      <p>&copy; ${year} Arnold. AI nutrition coach.</p>
    </div>
  </footer>

</body>
</html>`;
}
