export type AdminTab = 'stats' | 'flagged' | 'settings';

function navLink(label: string, href: string, active: boolean): string {
  const className = active
    ? 'px-3 py-2 rounded bg-gray-900 text-white text-sm'
    : 'px-3 py-2 rounded text-gray-300 hover:text-white hover:bg-gray-700 text-sm';
  return `<a href="${href}" class="${className}">${label}</a>`;
}

export function adminLayout(title: string, content: string, activeTab: AdminTab): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SavannaGuard — ${title}</title>
  <script src="https://unpkg.com/alpinejs@3.14.0/dist/cdn.min.js" defer></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css">
</head>
<body class="bg-gray-100 font-sans">
  <nav class="bg-gray-800 text-white p-4">
    <div class="container mx-auto flex flex-wrap gap-3 items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold">SavannaGuard Admin</h1>
        <div class="flex items-center gap-2">
          ${navLink('Stats', '/admin', activeTab === 'stats')}
          ${navLink('Flagged', '/admin/flagged', activeTab === 'flagged')}
          ${navLink('Settings', '/admin/settings', activeTab === 'settings')}
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
  return `<div x-data="{ loading: true, totalSessions: 0, humanCount: 0, botCount: 0, suspiciousCount: 0, avgScore: 0 }" x-init="fetch('/admin/api/stats').then(r=>r.json()).then(d=>Object.assign($data,d)).finally(()=>loading=false)">
    <template x-if="loading"><p class="text-gray-500 mb-3">Loading...</p></template>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-white p-4 rounded shadow"><p class="text-gray-500 text-sm">Last 24h Sessions</p><p class="text-2xl font-bold" x-text="totalSessions">0</p></div>
      <div class="bg-white p-4 rounded shadow"><p class="text-gray-500 text-sm">Last 24h Humans</p><p class="text-2xl font-bold text-green-600" x-text="humanCount">0</p></div>
      <div class="bg-white p-4 rounded shadow"><p class="text-gray-500 text-sm">Last 24h Bots</p><p class="text-2xl font-bold text-red-600" x-text="botCount">0</p></div>
      <div class="bg-white p-4 rounded shadow"><p class="text-gray-500 text-sm">Last 24h Avg Score</p><p class="text-2xl font-bold" x-text="avgScore != null ? Number(avgScore).toFixed(1) : '0.0'">0.0</p></div>
    </div>
    <div class="bg-white rounded shadow p-4 mt-4">
      <p class="text-sm text-gray-600">Suspicious sessions in last 24h: <span class="font-semibold" x-text="suspiciousCount">0</span></p>
    </div>
  </div>`;
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
  return `<div x-data="{ difficulty: 4, saving: false, saved: false }" x-init="fetch('/admin/api/settings').then(r=>r.json()).then(d=>difficulty=d.difficulty ?? 4)">
    <form @submit.prevent="saving=true; saved=false; fetch('/admin/settings', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({difficulty})}).then(r=>r.json()).then(d=>{difficulty=d.difficulty; saved=true;}).finally(()=>saving=false)" class="bg-white p-6 rounded shadow max-w-md">
      <h3 class="text-lg font-bold mb-4">Settings</h3>
      <label class="block mb-4">
        <span class="text-gray-700">PoW Difficulty (1–6, higher = harder)</span>
        <input type="number" x-model="difficulty" min="1" max="6" class="border p-2 w-full mt-1">
      </label>
      <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded" :disabled="saving">
        <span x-text="saving ? 'Saving...' : 'Save'"></span>
      </button>
      <p x-show="saved" class="text-green-700 text-sm mt-3">Saved.</p>
    </form>
  </div>`;
}