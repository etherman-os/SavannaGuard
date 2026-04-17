export type AdminTab = 'stats' | 'flagged' | 'settings' | 'threat' | 'federation' | 'vpn' | 'mobile' | 'multi-tenant';

function navLink(label: string, href: string, active: boolean, badge?: string): string {
  const className = active
    ? 'px-3 py-2 rounded bg-gray-900 text-white text-sm'
    : 'px-3 py-2 rounded text-gray-300 hover:text-white hover:bg-gray-700 text-sm';
  const badgeHtml = badge ? ` <span class="text-xs bg-blue-500 text-white px-1 rounded">${badge}</span>` : '';
  return `<a href="${href}" class="${className}">${label}${badgeHtml}</a>`;
}

export function adminLayout(title: string, content: string, activeTab: AdminTab): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SavannaGuard — ${title}</title>
  <script src="/admin/static/chart.umd.min.js"></script>
  <script src="/admin/static/alpine.min.js" defer></script>
  <link rel="stylesheet" href="/admin/static/tailwind.min.css">
  <style>
    .chart-container { position: relative; width: 100%; }
  </style>
</head>
<body class="bg-gray-100 font-sans">
  <nav class="bg-gray-800 text-white p-4">
    <div class="container mx-auto flex flex-wrap gap-3 items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold">SavannaGuard</h1>
        <div class="flex items-center gap-2">
          ${navLink('Stats', '/admin', activeTab === 'stats')}
          ${navLink('Threat Intel', '/admin/threat', activeTab === 'threat')}
          ${navLink('Flagged', '/admin/flagged', activeTab === 'flagged')}
          ${navLink('Settings', '/admin/settings', activeTab === 'settings')}
          ${navLink('Federation', '/admin/federation', activeTab === 'federation')}
          ${navLink('VPN Detection', '/admin/vpn', activeTab === 'vpn', 'CLOUD')}
          ${navLink('Mobile SDK', '/admin/mobile', activeTab === 'mobile', 'CLOUD')}
          ${navLink('Multi-Tenant', '/admin/multi-tenant', activeTab === 'multi-tenant', 'CLOUD')}
        </div>
      </div>
      <a href="/admin/logout" class="text-sm text-gray-300 hover:text-white">Logout</a>
    </div>
  </nav>
  <main class="container mx-auto p-6">
    <h2 class="text-2xl font-bold mb-4">${title}</h2>
    ${content}
  </main>
</body>
</html>`;
}

export function loginPage(error = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Login</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css">
</head>
<body class="bg-gray-100 flex items-center justify-center h-screen">
  <form method="POST" action="/admin/login" class="bg-white p-8 rounded shadow">
    <h2 class="text-xl mb-4">Admin Login</h2>
    ${error ? `<p class="text-red-500 mb-4">${error}</p>` : ''}
    <input type="password" name="password" placeholder="Password" class="border p-2 w-full mb-4">
    <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded w-full">Login</button>
  </form>
</body>
</html>`;
}

export function statsContent(): string {
  return `<div x-data="statsCharts()" x-init="init()">
  <template x-if="loading"><p class="text-gray-500 mb-3">Loading...</p></template>

  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="bg-white p-4 rounded shadow"><p class="text-gray-500 text-sm">Last 24h Sessions</p><p class="text-2xl font-bold" x-text="totalSessions">0</p></div>
    <div class="bg-white p-4 rounded shadow"><p class="text-gray-500 text-sm">Humans</p><p class="text-2xl font-bold text-green-600" x-text="humanCount">0</p></div>
    <div class="bg-white p-4 rounded shadow"><p class="text-gray-500 text-sm">Bots Blocked</p><p class="text-2xl font-bold text-red-600" x-text="botCount">0</p></div>
    <div class="bg-white p-4 rounded shadow"><p class="text-gray-500 text-sm">Avg Score</p><p class="text-2xl font-bold" x-text="avgScore != null ? Number(avgScore).toFixed(1) : '0.0'">0.0</p></div>
  </div>
  <div class="grid grid-cols-3 gap-4 mt-4">
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Bot Ratio (10min)</p>
      <div class="flex items-center gap-2">
        <p class="text-2xl font-bold" :class="botRatio > 40 ? 'text-red-600' : botRatio > 20 ? 'text-yellow-600' : 'text-green-600'" x-text="botRatio + '%'">0%</p>
        <div class="flex-1 bg-gray-200 rounded h-3">
          <div class="h-3 rounded" :class="botRatio > 40 ? 'bg-red-500' : botRatio > 20 ? 'bg-yellow-500' : 'bg-green-500'" :style="'width:' + Math.min(botRatio, 100) + '%'"></div>
        </div>
      </div>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Adaptive PoW Level</p>
      <p class="text-2xl font-bold text-blue-600" x-text="difficulty">4</p>
      <p class="text-xs text-gray-400 mt-1">Auto-adjusts based on threat</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Learning Samples</p>
      <p class="text-2xl font-bold text-purple-600" x-text="learningSamples">0</p>
      <p class="text-xs text-gray-400 mt-1">Model improves with data</p>
    </div>
  </div>

  <div class="bg-white rounded shadow p-4 mt-4">
    <h3 class="text-lg font-bold mb-2">Sessions Over Time (Last 24h)</h3>
    <div class="chart-container" style="height:280px;">
      <canvas x-ref="sessionsChart"></canvas>
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
    <div class="bg-white rounded shadow p-4">
      <h3 class="text-lg font-bold mb-2">Verdict Distribution</h3>
      <div class="chart-container" style="height:240px;">
        <canvas x-ref="verdictChart"></canvas>
      </div>
    </div>
<div class="bg-white rounded shadow p-4">
      <p class="text-sm text-gray-600">Learning Samples</p>
      <p class="text-2xl font-bold text-purple-600" x-text="learningSamples">0</p>
      <p class="text-xs text-gray-400 mt-1">Model improves with data</p>
    </div>
  </div>

  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Passive Protection</p>
      <p class="text-2xl font-bold" :class="ppEnabled ? 'text-green-600' : 'text-gray-400'" x-text="ppEnabled ? 'Active' : 'Off'">Off</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Datacenter IPs (24h)</p>
      <p class="text-2xl font-bold text-orange-600" x-text="ppDetections">0</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">DC Throttled (24h)</p>
      <p class="text-2xl font-bold text-yellow-600" x-text="ppThrottled">0</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">DC Ranges Loaded</p>
      <p class="text-2xl font-bold" x-text="ppRanges">0</p>
      <p class="text-xs text-gray-400 mt-1" x-text="'Block: ' + (ppBlockDc ? 'ON' : 'OFF') + ' | Limit: ' + ppLimit + '/min'"></p>
    </div>
  </div>
  </div>
</div>

<script>
document.addEventListener('alpine:init', () => {
  Alpine.data('statsCharts', () => ({
loading: true,
    totalSessions: 0,
    humanCount: 0,
    botCount: 0,
    suspiciousCount: 0,
    avgScore: 0,
    botRatio: 0,
    difficulty: 4,
    learningSamples: 0,
    ppEnabled: false,
    ppBlockDc: false,
    ppDetections: 0,
    ppThrottled: 0,
    ppRanges: 0,
    ppLimit: 3,
    hourly: [],
    verdicts: { human: 0, bot: 0, suspicious: 0 },
    sessionsChart: null,
    verdictChart: null,
    refreshInterval: null,

    async init() {
      await this.loadData();
      this.renderCharts();
      this.refreshInterval = setInterval(() => this.refresh(), 30000);
    },

    async loadData() {
      try {
        const [ts, stats, pp] = await Promise.all([
          fetch('/admin/api/stats/timeseries').then(r => r.json()),
          fetch('/admin/api/stats').then(r => r.json()),
          fetch('/admin/api/passive-protection').then(r => r.json()),
        ]);
        this.hourly = ts.hourly || [];
        this.verdicts = ts.verdicts || { human: 0, bot: 0, suspicious: 0 };
        Object.assign(this.$data, stats);
        this.ppEnabled = pp.enabled;
        this.ppBlockDc = pp.blockDatacenterIPs;
        this.ppDetections = pp.dcDetectionsLast24h;
        this.ppThrottled = pp.dcThrottledLast24h;
        this.ppRanges = pp.datacenterRangesCount;
        this.ppLimit = pp.datacenterRateLimitMax;
      } catch (e) {
        console.error('Failed to load stats:', e);
      } finally {
        this.loading = false;
      }
    },

    async loadData() {
      try {
        const [ts, stats] = await Promise.all([
          fetch('/admin/api/stats/timeseries').then(r => r.json()),
          fetch('/admin/api/stats').then(r => r.json()),
        ]);
        this.hourly = ts.hourly || [];
        this.verdicts = ts.verdicts || { human: 0, bot: 0, suspicious: 0 };
        Object.assign(this.$data, stats);
      } catch (e) {
        console.error('Failed to load stats:', e);
      } finally {
        this.loading = false;
      }
    },

    renderCharts() {
      this.renderSessionsChart();
      this.renderVerdictChart();
    },

    renderSessionsChart() {
      const ctx = this.$refs.sessionsChart;
      if (!ctx) return;
      const labels = this.hourly.map(h => {
        const d = new Date(h.timestamp);
        return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      });
      this.sessionsChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Human', data: this.hourly.map(h => h.human), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.3 },
            { label: 'Bot', data: this.hourly.map(h => h.bot), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.3 },
            { label: 'Suspicious', data: this.hourly.map(h => h.suspicious), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', fill: true, tension: 0.3 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } },
            x: { grid: { display: false } },
          },
        },
      });
    },

    renderVerdictChart() {
      const ctx = this.$refs.verdictChart;
      if (!ctx) return;
      this.verdictChart = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: ['Human', 'Bot', 'Suspicious'],
          datasets: [{
            data: [this.verdicts.human, this.verdicts.bot, this.verdicts.suspicious],
            backgroundColor: ['#22c55e', '#ef4444', '#f59e0b'],
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
        },
      });
    },

    async refresh() {
      await this.loadData();
      this.updateCharts();
    },

    updateCharts() {
      if (!this.hourly || this.hourly.length === 0) return;
      const labels = this.hourly.map(h => {
        const d = new Date(h.timestamp);
        return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      });

      if (this.sessionsChart) {
        this.sessionsChart.data.labels = labels;
        this.sessionsChart.data.datasets[0].data = this.hourly.map(h => h.human);
        this.sessionsChart.data.datasets[1].data = this.hourly.map(h => h.bot);
        this.sessionsChart.data.datasets[2].data = this.hourly.map(h => h.suspicious);
        this.sessionsChart.update();
      }

      if (this.verdictChart) {
        this.verdictChart.data.datasets[0].data = [this.verdicts.human, this.verdicts.bot, this.verdicts.suspicious];
        this.verdictChart.update();
      }
    },
  }));
});
</script>`;
}

export function threatContent(): string {
  return `<div x-data="threatCharts()" x-init="init()">
  <template x-if="loading"><p class="text-gray-500">Loading...</p></template>

  <h3 class="text-lg font-bold mb-3">Adaptive Threat Level</h3>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Bot Ratio (10min)</p>
      <p class="text-2xl font-bold" :class="threat.botRatio > 40 ? 'text-red-600' : 'text-green-600'" x-text="(threat.botRatio || 0) + '%'">0%</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Current PoW Difficulty</p>
      <p class="text-2xl font-bold text-blue-600" x-text="threat.difficulty || 4">4</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Known Bot Signatures</p>
      <p class="text-2xl font-bold text-orange-600" x-text="sigs.total || 0">0</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Bot Sessions (10min)</p>
      <p class="text-2xl font-bold text-red-600" x-text="threat.botCount || 0">0</p>
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
    <div class="bg-white rounded shadow p-4">
      <h3 class="text-lg font-bold mb-2">Top Bot Signatures</h3>
      <div class="chart-container" style="height:260px;">
        <canvas x-ref="sigsChart"></canvas>
      </div>
    </div>
    <div class="bg-white rounded shadow p-4">
      <h3 class="text-lg font-bold mb-2">Signature Types</h3>
      <div class="chart-container" style="height:260px;">
        <canvas x-ref="typesChart"></canvas>
      </div>
    </div>
  </div>

  <h3 class="text-lg font-bold mb-3">ML Learning Progress</h3>
  <div class="bg-white rounded shadow p-4 mb-6">
    <template x-if="Object.keys(learning).length === 0"><p class="text-gray-400 text-sm">No learning data yet. Model starts learning after 10+ human sessions.</p></template>
    <table class="w-full text-sm">
      <thead class="bg-gray-100">
        <tr><th class="p-2 text-left">Signal</th><th class="p-2 text-left">Mean</th><th class="p-2 text-left">Std Dev</th><th class="p-2 text-left">Samples</th><th class="p-2 text-left">Status</th></tr>
      </thead>
      <tbody>
        <template x-for="(val, key) in learning" :key="key">
          <tr class="border-t">
            <td class="p-2 font-mono text-xs" x-text="key"></td>
            <td class="p-2" x-text="val.mean"></td>
            <td class="p-2" x-text="val.stddev"></td>
            <td class="p-2" x-text="val.count"></td>
            <td class="p-2">
              <span class="px-2 py-1 rounded text-xs" :class="val.count >= 10 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'" x-text="val.count >= 10 ? 'Active' : 'Learning...'"></span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>

  <h3 class="text-lg font-bold mb-3">Top Bot Signatures</h3>
  <div class="bg-white rounded shadow p-4">
    <template x-if="!sigs.topHits || sigs.topHits.length === 0"><p class="text-gray-400 text-sm">No bot signatures recorded yet.</p></template>
    <table x-show="sigs.topHits && sigs.topHits.length > 0" class="w-full text-sm">
      <thead class="bg-gray-100">
        <tr><th class="p-2 text-left">Hash</th><th class="p-2 text-left">Type</th><th class="p-2 text-left">Hits</th></tr>
      </thead>
      <tbody>
        <template x-for="hit in (sigs.topHits || [])" :key="hit.hash + hit.type">
          <tr class="border-t">
            <td class="p-2 font-mono text-xs" x-text="hit.hash.slice(0,12) + '...'"></td>
            <td class="p-2"><span class="px-2 py-1 rounded text-xs" :class="hit.type === 'ip' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'" x-text="hit.type === 'ip' ? 'IP' : 'UA'"></span></td>
            <td class="p-2 font-bold" x-text="hit.count"></td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</div>

<script>
document.addEventListener('alpine:init', () => {
  Alpine.data('threatCharts', () => ({
    loading: true,
    threat: {},
    learning: {},
    sigs: {},
    sigsChart: null,
    typesChart: null,

    async init() {
      await this.loadData();
      this.renderCharts();
    },

    async loadData() {
      try {
        const [t, l, s] = await Promise.all([
          fetch('/admin/api/threat').then(r => r.json()),
          fetch('/admin/api/learning').then(r => r.json()),
          fetch('/admin/api/signatures').then(r => r.json()),
        ]);
        this.threat = t;
        this.learning = l;
        this.sigs = s;
      } catch (e) {
        console.error('Failed to load threat data:', e);
      } finally {
        this.loading = false;
      }
    },

    renderCharts() {
      this.renderSigsChart();
      this.renderTypesChart();
    },

    renderSigsChart() {
      const ctx = this.$refs.sigsChart;
      if (!ctx || !this.sigs.topHits || this.sigs.topHits.length === 0) return;
      const top10 = this.sigs.topHits.slice(0, 10);
      const labels = top10.map(h => h.hash.slice(0, 8) + '...');
      const data = top10.map(h => h.count);
      const colors = top10.map(h => h.type === 'ip' ? '#3b82f6' : '#8b5cf6');
      this.sigsChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{ label: 'Hits', data, backgroundColor: colors, borderRadius: 4 }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { stepSize: 1 } },
            y: { grid: { display: false } },
          },
        },
      });
    },

    renderTypesChart() {
      const ctx = this.$refs.typesChart;
      if (!ctx) return;
      const ipCount = this.sigs.ipSignatures || 0;
      const uaCount = this.sigs.uaSignatures || 0;
      this.typesChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['IP Signatures', 'UA Signatures'],
          datasets: [{
            data: [ipCount, uaCount],
            backgroundColor: ['#3b82f6', '#8b5cf6'],
            borderWidth: 2,
            borderColor: '#ffffff',
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
          cutout: '55%',
        },
      });
    },
  }));
});
</script>`;
}

export function flaggedContent(): string {
  return `<div x-data="{ sessions: null }" x-init="fetch('/admin/api/flagged').then(r=>r.json()).then(d=>sessions=d)">
  <template x-if="!sessions"><p>Loading...</p></template>
  <template x-if="sessions && sessions.length === 0"><p class="text-gray-500">No flagged sessions.</p></template>
  <table x-if="sessions && sessions.length > 0" class="w-full bg-white rounded shadow overflow-hidden">
    <thead class="bg-gray-200">
      <tr><th class="p-3 text-left">Session</th><th class="p-3 text-left">Verdict</th><th class="p-3 text-left">Score</th><th class="p-3 text-left">Time</th><th class="p-3 text-left">IP Hash</th></tr>
    </thead>
    <tbody>
      <template x-for="s in sessions" :key="s.id">
        <tr class="border-t">
          <td class="p-3 text-sm" x-text="s.id.slice(0,8) + '...'"></td>
          <td class="p-3"><span class="px-2 py-1 rounded text-xs" :class="s.verdict === 'bot' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'" x-text="s.verdict"></span></td>
          <td class="p-3" x-text="s.finalScore"></td>
          <td class="p-3 text-sm" x-text="new Date(s.createdAt).toLocaleString()"></td>
          <td class="p-3 text-sm font-mono text-xs" x-text="(s.ipHash || '').slice(0,12) + '...'"></td>
        </tr>
      </template>
    </tbody>
  </table>
</div>`;
}

export function settingsContent(): string {
  return `<div x-data="{ difficulty: 4, adaptiveEnabled: true, saving: false, saved: false }" x-init="fetch('/admin/api/settings').then(r=>r.json()).then(d=>{difficulty=d.difficulty ?? 4; adaptiveEnabled=d.adaptiveEnabled ?? true})">
  <form @submit.prevent="saving=true; saved=false; fetch('/admin/settings', {method:'POST', headers:{'Content-Type':'application/json','X-Requested-With':'SavannaAdmin'}, body: JSON.stringify({difficulty, adaptiveEnabled})}).then(r=>r.json()).then(d=>{difficulty=d.difficulty; saved=true;}).finally(()=>saving=false)" class="bg-white p-6 rounded shadow max-w-md">
    <h3 class="text-lg font-bold mb-4">Settings</h3>
    <label class="block mb-4">
      <span class="text-gray-700">PoW Difficulty (1-6)</span>
      <input type="number" x-model="difficulty" min="1" max="6" class="border p-2 w-full mt-1">
      <p class="text-xs text-gray-400 mt-1">Auto-adjusted by Adaptive PoW when enabled</p>
    </label>
    <label class="flex items-center gap-2 mb-4">
      <input type="checkbox" x-model="adaptiveEnabled" class="rounded">
      <span class="text-gray-700">Adaptive PoW (auto-adjust difficulty)</span>
    </label>
    <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded" :disabled="saving">
      <span x-text="saving ? 'Saving...' : 'Save'"></span>
    </button>
    <p x-show="saved" class="text-green-700 text-sm mt-3">Saved.</p>
  </form>
</div>`;
}

export function federationContent(): string {
  return `<div x-data="federation()" x-init="init()">
  <template x-if="loading"><p class="text-gray-500 mb-3">Loading...</p></template>

  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Total Peers</p>
      <p class="text-2xl font-bold" x-text="stats.peerCount">0</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Active Peers</p>
      <p class="text-2xl font-bold text-green-600" x-text="stats.activePeerCount">0</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Federated Signatures</p>
      <p class="text-2xl font-bold text-blue-600" x-text="stats.signatureCount">0</p>
    </div>
    <div class="bg-white p-4 rounded shadow">
      <p class="text-gray-500 text-sm">Avg Confidence</p>
      <p class="text-2xl font-bold" x-text="(stats.avgConfidence * 100).toFixed(0) + '%'">0%</p>
    </div>
  </div>

  <div class="bg-white rounded shadow p-4 mb-6">
    <h3 class="text-lg font-bold mb-2">Peer Status</h3>
    <div class="chart-container" style="height:200px;">
      <canvas x-ref="peerChart"></canvas>
    </div>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <div class="bg-white p-4 rounded shadow">
      <h3 class="text-lg font-bold mb-4">Trusted Peers</h3>

      <form @submit.prevent="addingPeer=true; fetch('/admin/api/federation/peers', {method:'POST', headers:{'Content-Type':'application/json','X-Requested-With':'SavannaAdmin'}, body: JSON.stringify({peerUrl: newPeerUrl, psk: newPeerPsk})}).then(r=>r.json()).then(()=>{newPeerUrl=''; newPeerPsk=''; refresh()}).finally(()=>addingPeer=false)" class="mb-4">
        <div class="flex gap-2">
          <input type="url" x-model="newPeerUrl" placeholder="https://peer.example.com" class="border p-2 flex-1" required>
          <input type="password" x-model="newPeerPsk" placeholder="PSK" class="border p-2 w-32" required>
          <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded" :disabled="addingPeer">
            <span x-text="addingPeer ? '...' : '+ Add'"></span>
          </button>
        </div>
      </form>

      <template x-if="peers.length === 0">
        <p class="text-gray-500 text-sm">No peers configured. Add a peer to start sharing bot signatures.</p>
      </template>

      <table class="w-full text-sm" x-show="peers.length > 0">
        <thead>
          <tr class="text-left text-gray-500 border-b">
            <th class="pb-2">Peer URL</th>
            <th class="pb-2">Status</th>
            <th class="pb-2">Last Seen</th>
            <th class="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          <template x-for="peer in peers" :key="peer.peerId">
            <tr class="border-b">
              <td class="py-2 truncate" x-text="peer.peerUrl"></td>
              <td class="py-2">
                <span class="px-2 py-1 rounded text-xs" :class="peer.status === 'active' ? 'bg-green-100 text-green-800' : peer.status === 'offline' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'" x-text="peer.status"></span>
              </td>
              <td class="py-2 text-gray-500" x-text="peer.lastSeen ? new Date(peer.lastSeen).toLocaleString() : 'Never'"></td>
              <td class="py-2">
                <button @click="fetch('/admin/api/federation/peers/' + peer.peerId, {method:'DELETE', headers:{'X-Requested-With':'SavannaAdmin'}}).then(()=>refresh())" class="text-red-600 hover:text-red-800">Remove</button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div class="bg-white p-4 rounded shadow">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold">Top Federated Signatures</h3>
        <button @click="syncing=true; fetch('/admin/api/federation/sync', {method:'POST', headers:{'Content-Type':'application/json','X-Requested-With':'SavannaAdmin'}, body: JSON.stringify({peerUrl: ''})}).finally(()=>{syncing=false; refresh()})" class="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded">
          <span x-text="syncing ? 'Syncing...' : 'Sync All'"></span>
        </button>
      </div>

      <template x-if="topSignatures.length === 0">
        <p class="text-gray-500 text-sm">No federated signatures yet. Signatures appear when other instances report bots.</p>
      </template>

      <table class="w-full text-sm" x-show="topSignatures.length > 0">
        <thead>
          <tr class="text-left text-gray-500 border-b">
            <th class="pb-2">Hash (partial)</th>
            <th class="pb-2">Type</th>
            <th class="pb-2">Confidence</th>
            <th class="pb-2">Reporters</th>
          </tr>
        </thead>
        <tbody>
          <template x-for="sig in topSignatures" :key="sig.hash + sig.hashType">
            <tr class="border-b">
              <td class="py-2 font-mono text-xs" x-text="sig.hash.substring(0, 8) + '...'"></td>
              <td class="py-2" x-text="sig.hashType"></td>
              <td class="py-2" x-text="(sig.confidence * 100).toFixed(0) + '%'"></td>
              <td class="py-2" x-text="sig.reporterCount"></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</div>

<script>
document.addEventListener('alpine:init', () => {
  Alpine.data('federation', () => ({
    loading: true,
    stats: { peerCount: 0, activePeerCount: 0, offlinePeerCount: 0, signatureCount: 0, avgConfidence: 0 },
    peers: [],
    topSignatures: [],
    newPeerUrl: '',
    newPeerPsk: '',
    addingPeer: false,
    syncing: false,
    peerChart: null,

    async init() {
      await this.refresh();
      this.renderPeerChart();
    },

    async refresh() {
      this.loading = true;
      try {
        const [statsRes, peersRes] = await Promise.all([
          fetch('/admin/api/federation/stats').then(r => r.json()),
          fetch('/admin/api/federation/peers').then(r => r.json())
        ]);
        this.stats = statsRes;
        this.peers = peersRes;
        this.topSignatures = statsRes.topSignatures || [];
        this.updatePeerChart();
      } catch (e) {
        console.error('Failed to load federation data:', e);
      } finally {
        this.loading = false;
      }
    },

    renderPeerChart() {
      const ctx = this.$refs.peerChart;
      if (!ctx) return;
      const active = this.stats.activePeerCount || 0;
      const offline = (this.stats.peerCount || 0) - active;
      this.peerChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Active', 'Offline'],
          datasets: [{
            data: [active, offline],
            backgroundColor: ['#22c55e', '#ef4444'],
            borderWidth: 2,
            borderColor: '#ffffff',
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
          cutout: '55%',
        },
      });
    },

    updatePeerChart() {
      if (!this.peerChart) {
        this.renderPeerChart();
        return;
      }
      const active = this.stats.activePeerCount || 0;
      const offline = (this.stats.peerCount || 0) - active;
      this.peerChart.data.datasets[0].data = [active, offline];
      this.peerChart.update();
    },
  }));
});
</script>`;
}

function upsellCard(featureName: string, description: string, iconSvg: string): string {
  return `
<div class="flex items-center justify-center" style="min-height:60vh">
  <div class="bg-white rounded shadow p-8 max-w-lg w-full text-center">
    <div class="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6);">
      ${iconSvg}
    </div>
    <h3 class="text-xl font-bold text-gray-800 mb-2">${featureName}</h3>
    <p class="text-gray-500 mb-4">${description}</p>
    <hr class="my-4 border-gray-200">
    <p class="text-gray-600 mb-4">This feature is available in <strong>SavannaGuard Cloud</strong></p>
    <a href="https://savannaguard.com" target="_blank" rel="noopener noreferrer" class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 rounded transition-colors">
      SavannaGuard Cloud &rarr;
    </a>
  </div>
</div>`;
}

export function vpnContent(): string {
  return upsellCard(
    'VPN Detection',
    'Detect VPN, proxy, and datacenter connections in real-time',
    '<svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>'
  );
}

export function mobileContent(): string {
  return upsellCard(
    'Mobile SDK',
    'Native iOS and Android SDKs for mobile app protection',
    '<svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>'
  );
}

export function multiTenantContent(): string {
  return upsellCard(
    'Multi-Tenant',
    'Manage multiple sites and tenants from a single control plane',
    '<svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-4 0H5m4 0H3m2 0V5a2 2 0 012-2h4a2 2 0 012 2v14m0 0h2m-2 0h5"/></svg>'
  );
}