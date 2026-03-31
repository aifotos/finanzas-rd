// ============================================================
// SUPABASE CONFIG
// ============================================================
const SUPABASE_URL = 'https://pwpxvapwyfpepcntvzon.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3cHh2YXB3eWZwZXBjbnR2em9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMjAxMTgsImV4cCI6MjA4OTg5NjExOH0.JtiQaEOnAiFmPYAqiJRqGxT-npmbHk_kCD2FirXVMS4';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// STATE
// ============================================================
let state = {
  section: 'dashboard',
  theme: 'light',
  transactions: [],
  creditCards: [],
  loans: [],
  loanPayments: [],
  budgetCategories: [],
  savingsDeposits: [],
  ingresos: [],
  plantillas: [],
  user: null,
  quickTxOpen: false,
};

const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MONTHS_FULL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// ============================================================
// HELPERS
// ============================================================
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const money = n => 'RD$' + Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const moneyShort = n => { const v=Number(n||0); return v>=1000000?'RD$'+(v/1000000).toFixed(1)+'M':v>=1000?'RD$'+(v/1000).toFixed(0)+'K':money(v); };
const today = () => new Date().toISOString().split('T')[0];
const curMonth = () => { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); };
const monthLabel = ym => { const[y,m]=ym.split('-'); return MONTHS_FULL[parseInt(m)-1]+' '+y; };
const pct = (a,b) => b>0?(a/b*100):0;
const clamp = (v,min,max) => Math.max(min,Math.min(max,v));

function fdate(d) {
  if(!d) return '';
  const dt = new Date(d+'T00:00:00');
  return dt.getDate()+' '+MONTHS_ES[dt.getMonth()]+' '+dt.getFullYear();
}

function fdateShort(d) {
  if(!d) return '';
  const dt = new Date(d+'T00:00:00');
  return dt.getDate()+' '+MONTHS_ES[dt.getMonth()];
}

function daysUntil(day) {
  const d=new Date(), c=d.getDate();
  const dim=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  return day>c ? day-c : dim-c+day;
}

function getLastCutoff(cutDay) {
  const n=new Date(), y=n.getFullYear(), m=n.getMonth();
  return n.getDate()>=cutDay ? new Date(y,m,cutDay) : new Date(y,m-1,cutDay);
}
function getNextCutoff(cutDay) {
  const n=new Date(), y=n.getFullYear(), m=n.getMonth();
  return n.getDate()<cutDay ? new Date(y,m,cutDay) : new Date(y,m+1,cutDay);
}
function getDeadline(cutDay, dias) {
  const c=getLastCutoff(cutDay);
  const d=new Date(c); d.setDate(d.getDate()+dias);
  return d;
}

// ============================================================
// COMPUTED VALUES
// ============================================================
function getLiquidez() {
  // Liquidez = solo tarjetas de débito
  return state.creditCards
    .filter(c => c.tipo_tarjeta === 'debito')
    .reduce((s,c) => s + Number(c.saldo_actual), 0);
}

function getDeudaTC() {
  return state.creditCards
    .filter(c => c.tipo_tarjeta !== 'debito')
    .reduce((s,c) => s + Number(c.saldo_actual), 0);
}

function getDeudaPrestamos() {
  return state.loans
    .filter(l => l.estado !== 'pagado' && l.direccion !== 'otorgado')
    .reduce((s,l) => s + Number(l.monto_adeudado), 0);
}

function getObligacionesMes() {
  const cuotasPrestamos = state.loans
    .filter(l => l.estado !== 'pagado' && l.direccion !== 'otorgado')
    .reduce((s,l) => s + Number(l.cuota_mensual), 0);
  const presupuesto = state.budgetCategories
    .filter(c => (c.tipo_gasto||'fijo') !== 'periodico')
    .reduce((s,c) => s + (Number(c.presupuesto_max) || Number(c.presupuesto) || 0), 0);
  return cuotasPrestamos + presupuesto;
}

function getGastosMes() {
  const cm = curMonth();
  return state.transactions
    .filter(t => t.fecha?.startsWith(cm) && t.tipo === 'gasto')
    .reduce((s,t) => s + Number(t.monto), 0);
}

function getIngresosMes() {
  const cm = curMonth();
  return state.ingresos
    .filter(v => v.fecha?.startsWith(cm))
    .reduce((s,v) => s + Number(v.monto), 0);
}

function getDisponibleParaGastar() {
  const liquidez = getLiquidez();
  const cm = curMonth();
  const gastosMes = getGastosMes();
  const obligaciones = getObligacionesMes();
  // Disponible = liquidez - (obligaciones pendientes - lo ya gastado este mes)
  // Simplificado: liquidez - max(0, obligaciones - gastosMes) es confuso
  // Mejor: liquidez directa, la persona decide
  // Pero la idea es: cuánto puedo gastar sin meterme en problemas
  // = Liquidez - (obligaciones del mes que faltan por pagar)
  const faltaPorPagar = Math.max(0, obligaciones - gastosMes);
  return liquidez - faltaPorPagar;
}

// Sparkline data: last 6 months income vs expense
function getSparklineData() {
  const data = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const ym = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const ing = state.ingresos.filter(v => v.fecha?.startsWith(ym)).reduce((s,v) => s+Number(v.monto), 0);
    const gas = state.transactions.filter(t => t.fecha?.startsWith(ym) && t.tipo==='gasto').reduce((s,t) => s+Number(t.monto), 0);
    data.push({ month: MONTHS_ES[d.getMonth()], ing, gas });
  }
  return data;
}

function getCardLabel(metodo) {
  if (metodo === 'efectivo') return '💵 Efectivo';
  const cc = state.creditCards.find(c => c.id === metodo);
  if (!cc) return metodo;
  return (cc.tipo_tarjeta === 'debito' ? '🏧 ' : '💳 ') + (cc.nombre_display || cc.banco);
}

function getCardLabelShort(metodo) {
  if (metodo === 'efectivo') return 'Efectivo';
  const cc = state.creditCards.find(c => c.id === metodo);
  return cc ? (cc.nombre_display || cc.banco) : metodo;
}

// ============================================================
// DATA LOADING
// ============================================================
async function loadAll() {
  const [tx,cc,lo,lp,bc,sd,st,ing,pl] = await Promise.all([
    db.from('transactions').select('*').order('fecha',{ascending:false}),
    db.from('credit_cards').select('*'),
    db.from('loans').select('*'),
    db.from('loan_payments').select('*').order('fecha',{ascending:false}),
    db.from('budget_categories').select('*').order('orden'),
    db.from('savings_deposits').select('*').order('fecha',{ascending:true}),
    db.from('settings').select('*'),
    db.from('ingresos').select('*').order('fecha',{ascending:false}),
    db.from('ingreso_plantillas').select('*').order('orden'),
  ]);
  state.transactions = tx.data || [];
  state.creditCards = cc.data || [];
  state.loans = lo.data || [];
  state.loanPayments = lp.data || [];
  state.budgetCategories = bc.data || [];
  state.savingsDeposits = sd.data || [];
  state.ingresos = ing.data || [];
  state.plantillas = pl.data || [];
  const themeSetting = (st.data||[]).find(s => s.key === 'theme');
  if (themeSetting) {
    const v = themeSetting.value;
    state.theme = (typeof v === 'string') ? v.replace(/"/g,'') : (v || 'light');
  }
  document.documentElement.setAttribute('data-theme', state.theme);
}

// ============================================================
// RENDER ENGINE
// ============================================================
function render() {
  const app = $('#app');
  app.className = 'app';
  app.innerHTML = renderTopbar() + renderMain() + renderSlideMenu();
  // FAB button - always visible
  if (state.user) {
    app.innerHTML += `<button class="fab" id="fabTx" title="Nueva transacción">+</button>`;
  }
  bindEvents();
}

function renderTopbar() {
  return `<header class="topbar">
    <div class="topbar-logo" data-nav="dashboard">FinanzasRD</div>
    <div class="topbar-right">
      <span class="topbar-user">${state.user ? state.user.email.split('@')[0] : ''}</span>
      <button class="hamburger" id="menuToggle">☰</button>
    </div>
  </header>`;
}

function renderSlideMenu() {
  const items = [
    { id:'dashboard', icon:'📊', label:'Dashboard' },
    { id:'transacciones', icon:'📝', label:'Transacciones' },
    { section:'Cuentas' },
    { id:'tarjetas', icon:'💳', label:'Tarjetas' },
    { id:'prestamos', icon:'🏦', label:'Préstamos' },
    { section:'Planificación' },
    { id:'presupuesto', icon:'📋', label:'Presupuesto' },
    { id:'ingresos', icon:'💵', label:'Ingresos' },
    { section:'Análisis' },
    { id:'analisis', icon:'📈', label:'Análisis y Proyección' },
  ];
  const nav = items.map(it => {
    if (it.section) return `<div class="menu-section-title">${it.section}</div>`;
    return `<div class="menu-item ${state.section===it.id?'active':''}" data-nav="${it.id}">
      <span class="menu-item-icon">${it.icon}</span>${it.label}
    </div>`;
  }).join('');

  return `<div class="menu-overlay" id="menuOverlay"></div>
  <div class="slide-menu" id="slideMenu">
    <div class="menu-header"><h3>Menú</h3><button class="menu-close" id="menuClose">✕</button></div>
    <div class="menu-nav">${nav}</div>
    <div class="menu-footer">
      <div class="flex-between" style="padding:8px 0">
        <span style="font-size:13px;color:var(--text-secondary)">${state.theme==='dark'?'🌙':'☀️'} Tema</span>
        <div class="toggle ${state.theme==='dark'?'on':''}" id="themeToggle"></div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="doLogout()" style="width:100%;justify-content:center;margin-top:8px">Cerrar Sesión</button>
    </div>
  </div>`;
}

function renderMain() {
  const views = {
    dashboard: viewDashboard,
    transacciones: viewTransacciones,
    tarjetas: viewTarjetas,
    prestamos: viewPrestamos,
    presupuesto: viewPresupuesto,
    ingresos: viewIngresos,
    analisis: viewAnalisis,
  };
  return `<main class="main">${(views[state.section] || viewDashboard)()}</main>`;
}

// ============================================================
// DASHBOARD
// ============================================================
function viewDashboard() {
  const cm = curMonth();
  const mtx = state.transactions.filter(t => t.fecha?.startsWith(cm));
  const gastos = getGastosMes();
  const totalIng = getIngresosMes();
  const liquidez = getLiquidez();
  const deudaTC = getDeudaTC();
  const deudaP = getDeudaPrestamos();
  const disponible = getDisponibleParaGastar();
  const obligaciones = getObligacionesMes();

  // Debit card breakdown
  const debitos = state.creditCards.filter(c => c.tipo_tarjeta === 'debito');
  const debitBreakdown = debitos.map(c =>
    `<div class="hero-breakdown-item">
      <div class="hero-breakdown-label">🏧 ${c.nombre_display || c.banco}</div>
      <div class="hero-breakdown-value">${money(c.saldo_actual)}</div>
    </div>`
  ).join('');

  // Alerts
  let alerts = '';
  state.budgetCategories.forEach(cat => {
    if (cat.tipo_gasto === 'periodico') return;
    const budRef = Number(cat.presupuesto_max) || Number(cat.presupuesto) || 0;
    if (budRef === 0) return;
    const spent = mtx.filter(t => t.tipo==='gasto' && t.categoria===cat.id).reduce((s,t) => s+Number(t.monto), 0);
    if (spent >= budRef)
      alerts += `<div class="alert alert-danger">🚨 ${cat.icono} ${cat.nombre}: Excedido — ${money(spent)} / ${money(budRef)}<span class="alert-action" data-nav="presupuesto">Ver</span></div>`;
    else if (spent >= budRef * 0.85)
      alerts += `<div class="alert alert-warning">⚠️ ${cat.icono} ${cat.nombre}: ${Math.round(pct(spent,budRef))}% usado — ${money(spent)} / ${money(budRef)}<span class="alert-action" data-nav="presupuesto">Ajustar</span></div>`;
  });

  // Overdue loan alerts
  const now = new Date();
  state.loans.filter(l => l.direccion==='otorgado' && l.estado==='activo').forEach(l => {
    const venc = l.fecha_vencimiento || l.fecha_finalizacion;
    if (venc && new Date(venc+'T00:00:00') < now)
      alerts += `<div class="alert alert-danger">🚨 Préstamo a ${l.persona||l.nombre}: Vencido — ${money(l.monto_adeudado)}<span class="alert-action" data-nav="prestamos">Ver</span></div>`;
  });

  // Debit card expiry
  state.creditCards.filter(c => c.tipo_tarjeta==='debito' && c.fecha_vencimiento).forEach(c => {
    const daysToExp = Math.ceil((new Date(c.fecha_vencimiento+'T00:00:00') - now) / 86400000);
    if (daysToExp <= 0)
      alerts += `<div class="alert alert-danger">🚨 🏧 ${c.nombre_display||c.banco}: Tarjeta vencida</div>`;
    else if (daysToExp <= 30)
      alerts += `<div class="alert alert-warning">⚠️ 🏧 ${c.nombre_display||c.banco}: Vence en ${daysToExp} días</div>`;
  });

  // Upcoming payments
  let upcoming = [];
  state.loans.forEach(l => {
    if (l.estado === 'pagado' || l.direccion === 'otorgado') return;
    if (l.dia_pago) {
      const d = daysUntil(l.dia_pago);
      if (d <= 15) upcoming.push({ nombre: l.nombre, monto: l.cuota_mensual, dias: d, tipo: 'prestamo' });
    }
  });
  state.creditCards.filter(c => c.tipo_tarjeta !== 'debito').forEach(c => {
    const dl = getDeadline(c.fecha_corte, c.dias_limite_pago);
    const diff = Math.ceil((dl - now) / 86400000);
    if (diff <= 15 && diff >= 0 && Number(c.saldo_actual) > 0)
      upcoming.push({ nombre: c.nombre_display || 'TC '+c.banco, monto: c.saldo_actual, dias: diff, tipo: 'tc' });
  });
  upcoming.sort((a,b) => a.dias - b.dias);

  // Budget mini
  const fijosCats = state.budgetCategories.filter(c => (c.tipo_gasto||'fijo') !== 'periodico');
  const presTotal = fijosCats.reduce((s,c) => s + (Number(c.presupuesto_max) || Number(c.presupuesto) || 0), 0);
  const presUsado = fijosCats.reduce((s,cat) => {
    return s + mtx.filter(t => t.tipo==='gasto' && t.categoria===cat.id).reduce((sum,t) => sum+Number(t.monto), 0);
  }, 0);

  let budgetMini = '';
  if (presTotal > 0) {
    const pctUsed = pct(presUsado, presTotal);
    const color = presUsado>presTotal ? 'var(--danger)' : presUsado>presTotal*0.85 ? 'var(--warning)' : 'var(--success)';
    const topCats = fijosCats.filter(c => Number(c.presupuesto) > 0).slice(0,4).map(cat => {
      const sp = mtx.filter(t => t.tipo==='gasto' && t.categoria===cat.id).reduce((s,t) => s+Number(t.monto), 0);
      const p = pct(sp, Number(cat.presupuesto_max) || Number(cat.presupuesto));
      return `<div style="margin-bottom:8px">
        <div class="flex-between" style="margin-bottom:3px">
          <span style="font-size:12px">${cat.icono} ${cat.nombre}</span>
          <span class="mono" style="font-size:10.5px;color:${p>100?'var(--danger)':'var(--text-secondary)'}">${Math.round(p)}%</span>
        </div>
        <div class="progress-bar" style="height:4px"><div class="progress-fill" style="width:${clamp(p,0,100)}%;background:${p>100?'var(--danger)':p>85?'var(--warning)':'var(--accent)'}"></div></div>
      </div>`;
    }).join('');
    budgetMini = `
      <div class="flex-between mb-3">
        <span style="font-size:12px;color:var(--text-secondary)">${money(presUsado)} de ${money(presTotal)}</span>
        <span class="badge ${presUsado>presTotal?'badge-danger':presUsado>presTotal*0.85?'badge-warning':'badge-success'}">${Math.round(pctUsed)}%</span>
      </div>
      <div class="progress-bar mb-4"><div class="progress-fill" style="width:${clamp(pctUsed,0,100)}%;background:${color}"></div></div>
      ${topCats}
      <button class="btn btn-ghost btn-sm mt-3" data-nav="presupuesto" style="width:100%;justify-content:center">Ver presupuesto →</button>`;
  } else {
    budgetMini = `<div class="empty-state" style="padding:20px"><div class="empty-icon">📋</div><p style="font-size:13px">Configura tu presupuesto</p><button class="btn btn-primary btn-sm mt-3" data-nav="presupuesto">Configurar</button></div>`;
  }

  // CC utilization
  const creditos = state.creditCards.filter(c => c.tipo_tarjeta !== 'debito');
  let ccUtil = creditos.length > 0 ? creditos.map(cc => {
    const p = pct(Number(cc.saldo_actual), Number(cc.monto_aprobado));
    return `<div style="margin-bottom:10px">
      <div class="flex-between" style="margin-bottom:3px">
        <span style="font-size:12px;font-weight:600">${cc.nombre_display || 'TC '+cc.banco}</span>
        <span class="badge ${p>80?'badge-danger':p>50?'badge-warning':'badge-success'}">${p.toFixed(0)}%</span>
      </div>
      <div class="progress-bar" style="height:5px"><div class="progress-fill" style="width:${clamp(p,0,100)}%;background:${p>80?'var(--danger)':p>50?'var(--warning)':'var(--accent)'}"></div></div>
      <div style="font-size:10.5px;color:var(--text-muted);margin-top:2px">${money(cc.saldo_actual)} de ${money(cc.monto_aprobado)}</div>
    </div>`;
  }).join('') : '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Sin tarjetas de crédito</div>';

  // Sparkline
  const sparkData = getSparklineData();
  const sparkMax = Math.max(...sparkData.map(d => Math.max(d.ing, d.gas)), 1);
  const sparkW = 100, sparkH = 50;
  const ingPoints = sparkData.map((d,i) => `${(i/(sparkData.length-1))*sparkW},${sparkH - (d.ing/sparkMax)*sparkH}`).join(' ');
  const gasPoints = sparkData.map((d,i) => `${(i/(sparkData.length-1))*sparkW},${sparkH - (d.gas/sparkMax)*sparkH}`).join(' ');
  const sparkLabels = sparkData.map((d,i) => `<text x="${(i/(sparkData.length-1))*sparkW}" y="${sparkH+10}" fill="var(--text-muted)" font-size="3.5" text-anchor="middle">${d.month}</text>`).join('');

  const sparklineSVG = `<div class="sparkline-container">
    <svg viewBox="-2 -2 ${sparkW+4} ${sparkH+14}" preserveAspectRatio="none">
      <polyline points="${ingPoints}" fill="none" stroke="var(--success)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <polyline points="${gasPoints}" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3,2"/>
      ${sparkLabels}
    </svg>
    <div class="flex gap-4" style="justify-content:center;margin-top:4px">
      <span style="font-size:10px;color:var(--success)">— Ingresos</span>
      <span style="font-size:10px;color:var(--danger)">- - Gastos</span>
    </div>
  </div>`;

  // Recent tx
  let recentTx = '';
  if (state.transactions.length > 0) {
    const rows = state.transactions.slice(0,8).map(t => {
      const cat = state.budgetCategories.find(c => c.id === t.categoria);
      return `<tr>
        <td style="font-size:12px;color:var(--text-muted)">${fdateShort(t.fecha)}</td>
        <td style="font-weight:500">${t.descripcion || '—'}</td>
        <td style="font-size:12px">${cat ? cat.icono+' '+cat.nombre : '—'}</td>
        <td class="text-right mono fw-700" style="color:${t.tipo==='gasto'?'var(--danger)':'var(--success)'};font-size:12.5px">${t.tipo==='gasto'?'-':'+'} ${money(t.monto)}</td>
      </tr>`;
    }).join('');
    recentTx = `<div class="table-container"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th class="text-right">Monto</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    recentTx = `<div class="empty-state"><div class="empty-icon">📝</div><p style="font-size:13px">Sin transacciones aún</p></div>`;
  }

  return `<div class="page-header"><h2>Dashboard</h2><p>${monthLabel(cm)}</p></div>
  ${alerts}
  <div class="grid-hero mb-5">
    <div class="hero-card">
      <div class="hero-label">Liquidez Disponible</div>
      <div class="hero-value">${money(liquidez)}</div>
      <div class="hero-sub">Solo cuentas de débito — el dinero que realmente tienes</div>
      ${debitos.length > 0 ? `<div class="hero-breakdown">${debitBreakdown}</div>` : ''}
    </div>
    <div>
      <div class="disponible-card mb-4">
        <div class="disponible-label">Disponible para Gastar</div>
        <div class="disponible-value ${disponible>=0?'positive':'negative'}">${money(disponible)}</div>
        <div class="disponible-sub">Liquidez − obligaciones pendientes del mes</div>
      </div>
      <div class="grid-2">
        <div class="stat-card"><div class="stat-label">Ingresos</div><div class="stat-value positive" style="font-size:17px">${money(totalIng)}</div></div>
        <div class="stat-card"><div class="stat-label">Gastos</div><div class="stat-value negative" style="font-size:17px">${money(gastos)}</div></div>
      </div>
    </div>
  </div>

  <div class="grid-3 mb-5">
    <div class="stat-card"><div class="stat-label">Deuda TC</div><div class="stat-value">${money(deudaTC)}</div><div class="stat-sub">No es tu dinero</div></div>
    <div class="stat-card"><div class="stat-label">Deuda Préstamos</div><div class="stat-value">${money(deudaP)}</div></div>
    <div class="stat-card"><div class="stat-label">Obligaciones/Mes</div><div class="stat-value">${money(obligaciones)}</div><div class="stat-sub">Cuotas + presupuesto</div></div>
  </div>

  <div class="grid-2 mb-5">
    <div class="card">
      <div class="card-title">Presupuesto del Mes</div>
      ${budgetMini}
    </div>
    <div class="card">
      <div class="card-title">Próximos Pagos</div>
      ${upcoming.length > 0 ? upcoming.slice(0,5).map(p => `
        <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:13px;font-weight:600">${p.nombre}</div>
            <div style="font-size:11px;color:var(--text-muted)">${p.dias===0?'⚠️ Hoy':'En '+p.dias+' días'}</div>
          </div>
          <div class="mono fw-700" style="font-size:13px">${money(p.monto)}</div>
        </div>`).join('') : `<div class="empty-state" style="padding:16px"><div style="font-size:28px">✅</div><p style="font-size:12px">Sin pagos próximos en 15 días</p></div>`}
      <div style="margin-top:16px">
        <div class="card-title" style="margin-top:4px">Utilización de Crédito</div>
        ${ccUtil}
      </div>
    </div>
  </div>

  <div class="grid-2 mb-5">
    <div class="card">
      <div class="card-title">Tendencia 6 Meses</div>
      ${sparklineSVG}
    </div>
    <div class="card">
      <div class="flex-between mb-3">
        <div class="card-title" style="margin-bottom:0">Últimas Transacciones</div>
        <button class="btn btn-ghost btn-sm" data-nav="transacciones">Ver todas</button>
      </div>
      ${recentTx}
    </div>
  </div>`;
}

// ============================================================
// TRANSACCIONES
// ============================================================
function viewTransacciones() {
  const cm = curMonth();
  const catOpts = state.budgetCategories.map(c => `<option value="${c.id}">${c.icono} ${c.nombre}</option>`).join('');
  const cardOpts = state.creditCards.map(c => `<option value="${c.id}">${c.tipo_tarjeta==='debito'?'🏧':'💳'} ${c.nombre_display||c.banco}</option>`).join('');

  // Stats for this month
  const mtx = state.transactions.filter(t => t.fecha?.startsWith(cm));
  const gastosMes = mtx.filter(t => t.tipo==='gasto').reduce((s,t) => s+Number(t.monto), 0);
  const ingMes = state.ingresos.filter(v => v.fecha?.startsWith(cm)).reduce((s,v) => s+Number(v.monto), 0);

  let rows = state.transactions.slice(0,60).map(t => {
    const cat = state.budgetCategories.find(c => c.id === t.categoria);
    const metodo = getCardLabelShort(t.metodo_pago);
    return `<tr>
      <td class="mono" style="font-size:11.5px">${fdate(t.fecha)}</td>
      <td style="font-weight:500">${t.descripcion || '—'}</td>
      <td style="font-size:12.5px">${cat ? cat.icono+' '+cat.nombre : '—'}</td>
      <td><span class="badge badge-neutral">${metodo}</span></td>
      <td class="text-right mono fw-700" style="color:${t.tipo==='gasto'?'var(--danger)':'var(--success)'};font-size:12.5px">${t.tipo==='gasto'?'-':'+'} ${money(t.monto)}</td>
      <td><button class="btn-icon" onclick="deleteTx('${t.id}')" title="Eliminar">🗑</button></td>
    </tr>`;
  }).join('');

  return `<div class="page-header"><h2>Transacciones</h2><p>Registro de todos tus movimientos — ${monthLabel(cm)}</p></div>
  <div class="grid-3 mb-5">
    <div class="stat-card"><div class="stat-label">Gastos del Mes</div><div class="stat-value negative">${money(gastosMes)}</div><div class="stat-sub">${mtx.filter(t=>t.tipo==='gasto').length} transacciones</div></div>
    <div class="stat-card"><div class="stat-label">Ingresos del Mes</div><div class="stat-value positive">${money(ingMes)}</div></div>
    <div class="stat-card"><div class="stat-label">Balance</div><div class="stat-value ${ingMes-gastosMes>=0?'positive':'negative'}">${money(ingMes-gastosMes)}</div></div>
  </div>
  <div class="card mb-5">
    <div class="card-title">Nuevo Gasto</div>
    <div class="grid-2" style="gap:12px">
      <div class="form-group"><label class="form-label">Monto (RD$)</label><input class="form-input" type="number" id="txMonto" placeholder="0.00" inputmode="decimal"></div>
      <div class="form-group"><label class="form-label">Categoría</label><select class="form-select" id="txCat">${catOpts}</select></div>
      <div class="form-group"><label class="form-label">Método de Pago</label><select class="form-select" id="txMetodo"><option value="efectivo">💵 Efectivo</option>${cardOpts}</select></div>
      <div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="date" id="txFecha" value="${today()}"></div>
      <div class="form-group" style="grid-column:1/-1"><label class="form-label">Descripción (opcional)</label><input class="form-input" id="txDesc" placeholder="¿En qué gastaste?"></div>
    </div>
    <button class="btn btn-primary mt-4" onclick="addTransaction()">Registrar Gasto</button>
  </div>
  <div class="card">
    <div class="card-title">Historial</div>
    ${rows.length > 0 ? `<div class="table-container"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Método</th><th class="text-right">Monto</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><div class="empty-icon">📭</div><p>Sin transacciones</p></div>'}
  </div>`;
}

// ============================================================
// TARJETAS
// ============================================================
function viewTarjetas() {
  const now = new Date();
  const creditos = state.creditCards.filter(c => c.tipo_tarjeta !== 'debito');
  const debitos = state.creditCards.filter(c => c.tipo_tarjeta === 'debito');

  function renderCard(cc) {
    const isCredit = cc.tipo_tarjeta !== 'debito';
    const cardColor = cc.color || '#2d5a27';
    const util = isCredit ? pct(Number(cc.saldo_actual), Number(cc.monto_aprobado)) : 0;
    const disp = Number(cc.monto_aprobado) - Number(cc.saldo_actual);
    const displayName = cc.nombre_display || ('Banco '+cc.banco);

    let deadlineInfo = '', cycleVis = '';
    if (isCredit) {
      const nextCorte = getNextCutoff(cc.fecha_corte);
      const lastCorte = getLastCutoff(cc.fecha_corte);
      const diasNextCorte = Math.ceil((nextCorte-now)/86400000);
      const dl = getDeadline(cc.fecha_corte, cc.dias_limite_pago);
      const diasP = Math.ceil((dl-now)/86400000);
      const dim = new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
      const dayPos = ((now.getDate()-1)/dim)*100;
      const cortePos = ((cc.fecha_corte-1)/dim)*100;

      deadlineInfo = `
        <div><div class="stat-label">Último Corte</div><div style="font-size:13px;font-weight:600">${lastCorte.getDate()} ${MONTHS_ES[lastCorte.getMonth()]}</div></div>
        <div><div class="stat-label">Próximo Corte</div><div style="font-size:13px;font-weight:600">${nextCorte.getDate()} ${MONTHS_ES[nextCorte.getMonth()]} <span class="badge badge-neutral">en ${diasNextCorte}d</span></div></div>
        <div><div class="stat-label">Límite Pago</div><div style="font-size:13px;font-weight:600">${dl.getDate()} ${MONTHS_ES[dl.getMonth()]} <span class="badge ${diasP<=5?'badge-danger':diasP<=10?'badge-warning':'badge-success'}">${diasP<=0?'Vencido':diasP+'d'}</span></div></div>
        <div><div class="stat-label">Sobregiro</div><div style="font-size:13px">${money(cc.monto_sobregiro)}</div></div>`;

      cycleVis = `<div style="margin-top:16px"><div class="stat-label">Ciclo</div>
        <div style="position:relative;height:32px;background:var(--bg-tertiary);border-radius:6px;overflow:hidden;margin-top:6px">
          <div style="position:absolute;left:0;top:0;height:100%;width:${dayPos}%;background:${cardColor};opacity:0.25;border-radius:6px"></div>
          <div style="position:absolute;left:${dayPos}%;top:0;width:2px;height:100%;background:${cardColor};z-index:2"></div>
          <div style="position:absolute;left:${cortePos}%;top:0;width:2px;height:100%;background:var(--danger);z-index:2"></div>
        </div>
        <div class="flex-between" style="margin-top:3px"><span style="font-size:9px;color:${cardColor};font-weight:600">Hoy</span><span style="font-size:9px;color:var(--danger);font-weight:600">Corte (${cc.fecha_corte})</span></div>
      </div>`;
    }

    let expiryInfo = '';
    if (!isCredit && cc.fecha_vencimiento) {
      const daysToExp = Math.ceil((new Date(cc.fecha_vencimiento+'T00:00:00') - now) / 86400000);
      const vencMM = cc.fecha_vencimiento.substring(5,7);
      const vencYY = cc.fecha_vencimiento.substring(0,4);
      expiryInfo = `<div><div class="stat-label">Vencimiento</div><div style="font-size:13px;font-weight:600">${vencMM}/${vencYY} <span class="badge ${daysToExp<=30?'badge-danger':daysToExp<=90?'badge-warning':'badge-neutral'}">${daysToExp>0?daysToExp+'d':'Vencida'}</span></div></div>`;
    }

    // Payment to TC button
    const payTCBtn = isCredit && Number(cc.saldo_actual) > 0 ? `
      <div style="margin-top:12px;padding:12px;background:var(--accent-light);border-radius:var(--radius-sm)">
        <div style="font-size:11px;font-weight:700;color:var(--accent);margin-bottom:8px">💳 Pagar a esta Tarjeta</div>
        <div class="flex gap-2">
          <input class="form-input" type="number" placeholder="Monto..." id="payTC-${cc.id}" style="flex:1;padding:7px 10px;font-size:13px">
          <select class="form-select" id="payTCFrom-${cc.id}" style="width:auto;padding:7px 10px;font-size:12px">
            <option value="efectivo">💵 Efectivo</option>
            ${debitos.map(d => `<option value="${d.id}">🏧 ${d.nombre_display||d.banco}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" onclick="payTC('${cc.id}')">Pagar</button>
        </div>
      </div>` : '';

    return `<div>
      <div class="cc-visual" style="background:linear-gradient(135deg,${cardColor},${cardColor}88)">
        <div class="flex-between">
          <div style="font-size:15px;font-weight:700">${displayName}</div>
          <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:10px">${isCredit?'Crédito':'Débito'}</span>
        </div>
        <div style="font-size:10px;opacity:0.7;text-transform:uppercase;letter-spacing:1px;margin-top:8px">${isCredit?'Saldo Actual':'Saldo Disponible'}</div>
        <div class="mono" style="font-size:22px;font-weight:700;margin-top:3px">${money(cc.saldo_actual)}</div>
        ${isCredit ? `<div style="margin-top:10px;height:5px;background:rgba(255,255,255,0.2);border-radius:3px;overflow:hidden"><div style="height:100%;border-radius:3px;width:${clamp(util,0,100)}%;background:${util>80?'#e74c3c':util>50?'#f0c040':'#2ecc71'}"></div></div><div style="font-size:10px;opacity:0.7;margin-top:4px">${util.toFixed(1)}% utilizado</div>` : ''}
      </div>
      <div class="card mt-3">
        <div class="flex-between mb-3">
          <div class="stat-label" style="margin-bottom:0">Detalles</div>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" onclick="showEditCard('${cc.id}')">✏️</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteCard('${cc.id}')">🗑</button>
          </div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:10px;margin-bottom:12px">
          <div style="font-size:10.5px;font-weight:700;color:var(--text-secondary);margin-bottom:6px">⚡ Ajustar Saldo</div>
          <div class="flex gap-2">
            <input class="form-input" type="number" placeholder="Saldo real..." id="adj-${cc.id}" style="flex:1;padding:7px 10px;font-size:13px">
            <button class="btn btn-primary btn-sm" onclick="adjustCardBalance('${cc.id}')">Ajustar</button>
          </div>
        </div>
        <div class="grid-2" style="gap:10px">
          ${isCredit ? `
            <div><div class="stat-label">Límite</div><div class="mono fw-700" style="font-size:15px">${money(cc.monto_aprobado)}</div></div>
            <div><div class="stat-label">Disponible</div><div class="mono fw-700" style="font-size:15px;color:${disp>0?'var(--success)':'var(--danger)'}">${money(disp)}</div></div>
          ` : `<div><div class="stat-label">Banco</div><div style="font-size:13px;font-weight:600">${cc.banco}</div></div>`}
          ${deadlineInfo}
          ${expiryInfo}
        </div>
        ${cycleVis}
        ${payTCBtn}
      </div>
    </div>`;
  }

  const colors = ['#2d5a27','#1a3a6b','#8b0000','#4a4a4a','#1a1a1a','#6b3fa0','#c0392b','#2980b9','#d4a017','#16a085','#e67e22','#7f8c8d'];
  const colorPicker = colors.map(c => `<div onclick="document.getElementById('ncColor').value='${c}';document.getElementById('ncColorPreview').style.background='${c}'" style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;border:2px solid var(--border)"></div>`).join('');

  const newCardForm = `<div class="card mb-5" id="newCardForm" style="display:none">
    <div class="card-title">Nueva Tarjeta</div>
    <div class="grid-2" style="gap:12px">
      <div class="form-group"><label class="form-label">Banco / Nombre</label><input class="form-input" id="ncBanco" placeholder="Ej: BHD, Popular..."></div>
      <div class="form-group"><label class="form-label">Tipo</label><select class="form-select" id="ncTipo" onchange="toggleCardFields()"><option value="credito">💳 Crédito</option><option value="debito">🏧 Débito</option></select></div>
      <div class="form-group"><label class="form-label">Color</label><div class="flex gap-2 flex-wrap" style="margin-bottom:6px">${colorPicker}</div><input type="hidden" id="ncColor" value="#2d5a27"><div id="ncColorPreview" style="width:100%;height:6px;border-radius:3px;background:#2d5a27"></div></div>
      <div class="form-group"><label class="form-label">Saldo Actual</label><input class="form-input" type="number" id="ncSaldo" placeholder="0.00"></div>
      <div class="form-group ncCreditField"><label class="form-label">Límite Aprobado</label><input class="form-input" type="number" id="ncLimite" placeholder="0.00"></div>
      <div class="form-group ncCreditField"><label class="form-label">Monto Sobregiro</label><input class="form-input" type="number" id="ncSobregiro" placeholder="0.00"></div>
      <div class="form-group ncCreditField"><label class="form-label">Día de Corte</label><input class="form-input" type="number" id="ncCorte" placeholder="1-31" min="1" max="31"></div>
      <div class="form-group ncCreditField"><label class="form-label">Días Límite Pago</label><input class="form-input" type="number" id="ncDiasPago" placeholder="25"></div>
      <div class="form-group ncDebitField" style="display:none"><label class="form-label">Vencimiento (MM/AAAA)</label><div class="flex gap-2"><select class="form-select" id="ncVencMes" style="width:90px">${[...Array(12)].map((_,i)=>`<option value="${String(i+1).padStart(2,'0')}">${String(i+1).padStart(2,'0')}</option>`).join('')}</select><input class="form-input" type="number" id="ncVencAnio" placeholder="2028" style="width:90px"></div></div>
    </div>
    <div class="flex gap-2 mt-4">
      <button class="btn btn-primary" onclick="saveNewCard()">💾 Guardar</button>
      <button class="btn btn-ghost" onclick="$('#newCardForm').style.display='none'">Cancelar</button>
    </div>
  </div>`;

  return `<div class="page-header">
    <div class="flex-between">
      <div><h2>Tarjetas</h2><p>Crédito y débito</p></div>
      <button class="btn btn-primary" onclick="$('#newCardForm').style.display='block'">+ Nueva Tarjeta</button>
    </div>
  </div>
  ${newCardForm}
  ${debitos.length > 0 ? `<div class="card-title mb-3">🏧 Débito — Liquidez: ${money(getLiquidez())}</div><div class="grid-2 mb-5">${debitos.map(renderCard).join('')}</div>` : ''}
  ${creditos.length > 0 ? `<div class="card-title mb-3">💳 Crédito — Deuda: ${money(getDeudaTC())}</div><div class="grid-2 mb-5">${creditos.map(renderCard).join('')}</div>` : ''}
  ${state.creditCards.length === 0 ? '<div class="card"><div class="empty-state"><div class="empty-icon">💳</div><p>Sin tarjetas registradas</p></div></div>' : ''}`;
}

// ============================================================
// PRESTAMOS (kept similar, cleaned up)
// ============================================================
function viewPrestamos() {
  const now = new Date();
  const tomados = state.loans.filter(l => l.direccion !== 'otorgado');
  const otorgados = state.loans.filter(l => l.direccion === 'otorgado');

  function renderLoan(loan) {
    const isOtorgado = loan.direccion === 'otorgado';
    const payments = state.loanPayments.filter(p => p.loan_id === loan.id);
    const montoBase = isOtorgado ? Number(loan.monto_original||loan.monto_desembolsado||loan.monto_adeudado) : loan.tipo==='prestamo' ? Number(loan.monto_original) : Number(loan.monto_desembolsado);
    const progress = montoBase > 0 ? pct(montoBase - Number(loan.monto_adeudado), montoBase) : 0;
    const diasP = loan.dia_pago ? daysUntil(loan.dia_pago) : null;
    const colorAccent = isOtorgado ? 'var(--accent)' : 'var(--danger)';

    let estadoBadge = '';
    if (loan.estado === 'pagado') estadoBadge = '<span class="badge badge-success">✅ Pagado</span>';
    else if (loan.estado === 'mora') estadoBadge = '<span class="badge badge-danger">⚠️ Mora</span>';
    else {
      const venc = loan.fecha_vencimiento || loan.fecha_finalizacion;
      if (venc && new Date(venc+'T00:00:00') < now && Number(loan.monto_adeudado) > 0)
        estadoBadge = '<span class="badge badge-danger">⚠️ Vencido</span>';
      else estadoBadge = '<span class="badge badge-success">Activo</span>';
    }

    const historial = payments.slice(0,5).map(p =>
      `<div class="flex-between" style="padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:11.5px">${fdate(p.fecha)}</span><span class="mono fw-700" style="font-size:12px;color:var(--success)">${money(p.monto)}</span></div>`
    ).join('');

    const personaInfo = isOtorgado ? `<div class="grid-2" style="gap:10px;margin-bottom:14px;padding:10px;background:var(--bg-tertiary);border-radius:var(--radius-sm)">
      <div><div class="stat-label">Persona</div><div style="font-size:13px;font-weight:600">${loan.persona||'—'}</div></div>
      <div><div class="stat-label">Contacto</div><div style="font-size:13px">${loan.contacto||'—'}</div></div>
    </div>` : '';

    return `<div class="card mb-5" style="border-left:4px solid ${colorAccent}">
      <div class="flex-between mb-3">
        <div>
          <div class="flex gap-2" style="align-items:center;gap:8px">
            <h3 style="font-size:16px;font-weight:700">${loan.nombre}</h3>
            ${estadoBadge}
          </div>
          ${diasP!==null?`<span class="badge badge-neutral" style="margin-top:4px">Día ${loan.dia_pago} — en ${diasP}d</span>`:''}
        </div>
        <div class="text-right">
          <div class="stat-label">${isOtorgado?'Te deben':'Adeudado'}</div>
          <div class="mono" style="font-size:20px;font-weight:700;color:${colorAccent}">${money(loan.monto_adeudado)}</div>
        </div>
      </div>
      ${personaInfo}
      <div class="progress-bar mb-3" style="height:8px"><div class="progress-fill" style="width:${progress}%;background:var(--success)"></div></div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:14px">${progress.toFixed(1)}% ${isOtorgado?'cobrado':'pagado'}</div>
      <div class="grid-4" style="gap:10px;margin-bottom:14px">
        <div><div class="stat-label">${loan.pago_unico?'Total':'Cuota'}</div><div class="mono fw-700">${money(loan.pago_unico?loan.monto_adeudado:loan.cuota_mensual)}</div></div>
        <div><div class="stat-label">Tasa</div><div class="fw-700">${Number(loan.tasa)>0?loan.tasa+'%':'—'}</div></div>
        <div><div class="stat-label">${loan.fecha_vencimiento?'Vence':'Fin'}</div><div style="font-size:12px">${fdate(loan.fecha_vencimiento||loan.fecha_finalizacion)}</div></div>
        <div><div class="stat-label">${isOtorgado?'Abonos':'Pagos'}</div><div class="fw-700">${payments.length}</div></div>
      </div>
      ${loan.estado!=='pagado' ? `
        <div class="flex gap-2 flex-wrap" style="align-items:flex-end">
          ${!loan.pago_unico && loan.cuota_mensual ? `<button class="btn btn-primary btn-sm" onclick="payLoan('${loan.id}')">${isOtorgado?'💰 Abono':'✅ Pago'} (${money(loan.cuota_mensual)})</button>` : ''}
          <div class="flex gap-2" style="align-items:center">
            <input class="form-input" type="number" placeholder="Monto" id="extra-${loan.id}" style="width:120px;padding:6px 8px;font-size:13px">
            <button class="btn btn-ghost btn-sm" onclick="payLoanExtra('${loan.id}')">${isOtorgado?'Abono':'Extra'}</button>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="markLoanStatus('${loan.id}','pagado')">✅ Saldado</button>
        </div>
      ` : '<div style="padding:10px;background:var(--success-light);border-radius:var(--radius-sm);text-align:center;color:var(--success);font-weight:600;font-size:13px">✅ Saldado</div>'}
      <div class="flex gap-2 mt-3">
        <button class="btn btn-ghost btn-sm" onclick="editLoan('${loan.id}')">✏️ Editar</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteLoan('${loan.id}')">🗑</button>
      </div>
      ${payments.length > 0 ? `<div style="margin-top:14px"><div class="stat-label">Historial</div>${historial}</div>` : ''}
    </div>`;
  }

  const newLoanForm = `<div class="card mb-5" id="newLoanForm" style="display:none">
    <div class="card-title">Nuevo Préstamo</div>
    <div class="grid-2" style="gap:12px">
      <div class="form-group"><label class="form-label">Dirección</label><select class="form-select" id="nlDir" onchange="toggleLoanFields()"><option value="tomado">📥 Tomado (yo debo)</option><option value="otorgado">📤 Otorgado (me deben)</option></select></div>
      <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="nlNombre" placeholder="Préstamo carro, Juan..."></div>
      <div class="form-group" id="nlPersonaGrp" style="display:none"><label class="form-label">Persona</label><input class="form-input" id="nlPersona" placeholder="Nombre"></div>
      <div class="form-group" id="nlContactoGrp" style="display:none"><label class="form-label">Contacto</label><input class="form-input" id="nlContacto" placeholder="Tel, detalle..."></div>
      <div class="form-group"><label class="form-label">Monto Total</label><input class="form-input" type="number" id="nlMonto" placeholder="0.00"></div>
      <div class="form-group"><label class="form-label">Adeudado Actual</label><input class="form-input" type="number" id="nlAdeudado" placeholder="Si es igual, déjalo vacío"></div>
      <div class="form-group"><label class="form-label">Tipo de Pago</label><select class="form-select" id="nlPagoTipo" onchange="toggleCuotaField()"><option value="cuotas">Cuotas mensuales</option><option value="unico">Pago único</option></select></div>
      <div class="form-group" id="nlCuotaGrp"><label class="form-label">Cuota Mensual</label><input class="form-input" type="number" id="nlCuota" placeholder="0.00"></div>
      <div class="form-group"><label class="form-label">Tasa (%)</label><input class="form-input" type="number" id="nlTasa" placeholder="0" value="0"></div>
      <div class="form-group" id="nlDiaGrp"><label class="form-label">Día de Pago</label><input class="form-input" type="number" id="nlDia" placeholder="1-31" min="1" max="31"></div>
      <div class="form-group"><label class="form-label">Vencimiento</label><input class="form-input" type="date" id="nlVenc"></div>
    </div>
    <div class="flex gap-2 mt-4">
      <button class="btn btn-primary" onclick="saveNewLoan()">💾 Guardar</button>
      <button class="btn btn-ghost" onclick="$('#newLoanForm').style.display='none'">Cancelar</button>
    </div>
  </div>`;

  const totalTeDeben = otorgados.filter(l=>l.estado!=='pagado').reduce((s,l)=>s+Number(l.monto_adeudado),0);
  const totalDebes = tomados.filter(l=>l.estado!=='pagado').reduce((s,l)=>s+Number(l.monto_adeudado),0);

  return `<div class="page-header">
    <div class="flex-between">
      <div><h2>Préstamos</h2><p>Deudas y préstamos personales</p></div>
      <button class="btn btn-primary" onclick="$('#newLoanForm').style.display='block'">+ Nuevo Préstamo</button>
    </div>
  </div>
  <div class="grid-2 mb-5">
    <div class="stat-card"><div class="stat-label">Debes</div><div class="stat-value negative">${money(totalDebes)}</div><div class="stat-sub">${tomados.filter(l=>l.estado!=='pagado').length} activos</div></div>
    <div class="stat-card"><div class="stat-label">Te Deben</div><div class="stat-value positive">${money(totalTeDeben)}</div><div class="stat-sub">${otorgados.filter(l=>l.estado!=='pagado').length} activos</div></div>
  </div>
  ${newLoanForm}
  ${tomados.length > 0 ? `<div class="card-title mb-3">📥 Tomados</div>${tomados.map(renderLoan).join('')}` : ''}
  ${otorgados.length > 0 ? `<div class="card-title mb-3" style="margin-top:20px">📤 Otorgados</div>${otorgados.map(renderLoan).join('')}` : ''}
  ${state.loans.length === 0 ? '<div class="card"><div class="empty-state"><div class="empty-icon">🏦</div><p>Sin préstamos registrados</p></div></div>' : ''}`;
}

// ============================================================
// PRESUPUESTO
// ============================================================
function viewPresupuesto() {
  const cm = curMonth();
  const mtx = state.transactions.filter(t => t.fecha?.startsWith(cm) && t.tipo === 'gasto');
  const allGastoTx = state.transactions.filter(t => t.tipo === 'gasto');
  const fijos = state.budgetCategories.filter(c => (c.tipo_gasto||'fijo') === 'fijo');
  const periodicos = state.budgetCategories.filter(c => c.tipo_gasto === 'periodico');
  const todayDate = new Date();
  const dayOfMonth = todayDate.getDate();
  const daysInMonth = new Date(todayDate.getFullYear(), todayDate.getMonth()+1, 0).getDate();
  const monthProgress = dayOfMonth / daysInMonth;

  const totalPFijo = fijos.reduce((s,c) => s + (Number(c.presupuesto_max) || Number(c.presupuesto) || 0), 0);
  const totalGFijo = fijos.reduce((s,c) => s + mtx.filter(t => t.categoria===c.id).reduce((sum,t) => sum+Number(t.monto), 0), 0);

  // Chart
  const chartCats = fijos.filter(c => (Number(c.presupuesto_max)||Number(c.presupuesto)) > 0).map(cat => {
    const spent = mtx.filter(t => t.categoria===cat.id).reduce((s,t) => s+Number(t.monto), 0);
    const budget = Number(cat.presupuesto_max) || Number(cat.presupuesto) || 0;
    return {...cat, spent, budget};
  });
  const chartMax = chartCats.length > 0 ? Math.max(...chartCats.map(c => Math.max(c.spent, c.budget))) : 1;
  let chartHTML = '';
  if (chartCats.length > 0) {
    const bars = chartCats.map(c => {
      const bH = Math.max(2, (c.budget/chartMax)*130);
      const sH = Math.max(c.spent>0?2:0, (c.spent/chartMax)*130);
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:45px">
        <div style="display:flex;align-items:flex-end;gap:2px;height:140px">
          <div style="width:14px;height:${bH}px;background:var(--accent);border-radius:3px 3px 0 0;opacity:0.35" title="Pres: ${money(c.budget)}"></div>
          <div style="width:14px;height:${sH}px;background:${c.spent>c.budget?'var(--danger)':c.spent>c.budget*0.85?'var(--warning)':'var(--accent)'};border-radius:3px 3px 0 0" title="Gastado: ${money(c.spent)}"></div>
        </div>
        <div style="font-size:8.5px;color:var(--text-muted);margin-top:4px;text-align:center;max-width:55px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.icono}</div>
      </div>`;
    }).join('');
    chartHTML = `<div class="card mb-5">
      <div class="card-title">Presupuesto vs Real</div>
      <div style="display:flex;align-items:flex-end;gap:3px;overflow-x:auto;padding-bottom:6px">${bars}</div>
      <div class="flex gap-4 mt-3" style="justify-content:center">
        <span style="font-size:10px;color:var(--text-muted)"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--accent);opacity:0.35;vertical-align:middle"></span> Pres.</span>
        <span style="font-size:10px;color:var(--text-muted)"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--accent);vertical-align:middle"></span> Gastado</span>
        <span style="font-size:10px;color:var(--text-muted)"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--danger);vertical-align:middle"></span> Excedido</span>
      </div>
    </div>`;
  }

  // Fijo rows
  const fijoRows = fijos.map(cat => {
    const spent = mtx.filter(t => t.categoria===cat.id).reduce((s,t) => s+Number(t.monto), 0);
    const bMax = Number(cat.presupuesto_max) || Number(cat.presupuesto) || 0;
    const budgetRef = bMax;
    const rem = budgetRef - spent;
    const p = budgetRef > 0 ? pct(spent, budgetRef) : 0;
    const st = p > 100 ? 'danger' : p > 85 ? 'warning' : 'success';
    let trend = '';
    if (budgetRef > 0 && spent > 0) {
      const proj = spent / monthProgress;
      const projP = pct(proj, budgetRef);
      if (projP > 110) trend = `<div style="font-size:9.5px;color:var(--danger);margin-top:2px">📈 Proy: ${money(proj)}</div>`;
    }
    return `<tr data-cat="${cat.id}">
      <td><div class="fw-700">${cat.icono} ${cat.nombre}</div>${trend}</td>
      <td><input class="form-input" type="number" value="${bMax||''}" onchange="updateBudgetRange('${cat.id}','max',this.value)" placeholder="0" style="width:100px;padding:5px 8px;font-size:12px"></td>
      <td class="mono td-spent" style="color:var(--danger)">${money(spent)}</td>
      <td class="mono td-rem" style="color:${rem>=0?'var(--success)':'var(--danger)'}">${money(rem)}</td>
      <td style="width:80px">${budgetRef>0?`<div class="progress-bar" style="height:5px"><div class="progress-fill" style="width:${clamp(p,0,100)}%;background:var(--${st})"></div></div>`:''}</td>
      <td class="td-badge">${budgetRef>0?`<span class="badge badge-${st}">${p>100?'+'+Math.round(p-100)+'%':Math.round(p)+'%'}</span>`:''}</td>
      <td><button class="btn-icon" onclick="deleteCat('${cat.id}')" style="color:var(--danger)" title="Eliminar">🗑</button></td>
    </tr>`;
  }).join('');

  // Periodic rows
  const periodicoRows = periodicos.map(cat => {
    const montoEst = Number(cat.monto_total) || 0;
    const catTx = allGastoTx.filter(t => t.categoria===cat.id).sort((a,b) => b.fecha.localeCompare(a.fecha));
    const lastTx = catTx[0] || null;
    const lastDate = lastTx ? new Date(lastTx.fecha+'T00:00:00') : null;
    const daysSinceLast = lastDate ? Math.floor((todayDate-lastDate)/86400000) : null;
    let avgDays = null;
    if (catTx.length >= 2) {
      let totalDays = 0;
      for (let i=0; i<catTx.length-1 && i<10; i++) {
        totalDays += Math.abs((new Date(catTx[i].fecha+'T00:00:00') - new Date(catTx[i+1].fecha+'T00:00:00')) / 86400000);
      }
      avgDays = Math.round(totalDays / Math.min(catTx.length-1, 10));
    }
    const spentThisMonth = mtx.filter(t => t.categoria===cat.id).reduce((s,t) => s+Number(t.monto), 0);
    const isOverdue = avgDays && daysSinceLast && daysSinceLast > avgDays;

    return `<div class="card mb-3" style="border-left:3px solid ${isOverdue?'var(--warning)':'var(--border)'}">
      <div class="flex-between">
        <div class="fw-700" style="font-size:14px">${cat.icono} ${cat.nombre}</div>
        <button class="btn-icon" onclick="deleteCat('${cat.id}')" style="color:var(--danger)">🗑</button>
      </div>
      <div class="grid-3 mt-3" style="gap:10px">
        <div><div class="stat-label">Estimado</div><div class="mono fw-700" style="font-size:13px">${montoEst>0?money(montoEst):'—'}</div></div>
        <div><div class="stat-label">Último</div><div style="font-size:13px">${lastTx?fdateShort(lastTx.fecha):'—'}</div>${daysSinceLast!==null?`<div style="font-size:10px;color:${isOverdue?'var(--warning)':'var(--text-muted)'}">Hace ${daysSinceLast}d${isOverdue?' ⚠️':''}</div>`:''}</div>
        <div><div class="stat-label">Promedio</div><div style="font-size:13px">${avgDays?'Cada '+avgDays+'d':'—'}</div></div>
      </div>
      ${spentThisMonth>0?`<div style="margin-top:10px;padding:6px 10px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:12px">Este mes: <span class="mono fw-700" style="color:var(--danger)">${money(spentThisMonth)}</span></div>`:''}
    </div>`;
  }).join('');

  const newCatForm = `<div class="card mb-5" id="newCatForm" style="display:none">
    <div class="card-title">Nueva Categoría</div>
    <div class="grid-2" style="gap:12px">
      <div class="form-group"><label class="form-label">Emoji</label><input class="form-input" id="ncEmoji" placeholder="📦" maxlength="4" style="width:70px;font-size:20px;text-align:center"></div>
      <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="ncNombre" placeholder="Categoría"></div>
      <div class="form-group"><label class="form-label">Tipo</label><select class="form-select" id="ncTipoGasto"><option value="fijo">📅 Fijo Mensual</option><option value="periodico">🔁 Periódico</option></select></div>
      <div class="form-group"><label class="form-label">Monto (opcional)</label><input class="form-input" type="number" id="ncMontoInit" placeholder="0.00"></div>
    </div>
    <div class="flex gap-2 mt-4">
      <button class="btn btn-primary" onclick="saveNewCategory()">💾 Guardar</button>
      <button class="btn btn-ghost" onclick="$('#newCatForm').style.display='none'">Cancelar</button>
    </div>
  </div>`;

  return `<div class="page-header">
    <div class="flex-between">
      <div><h2>Presupuesto</h2><p>${monthLabel(cm)} — Día ${dayOfMonth} de ${daysInMonth} (${Math.round(monthProgress*100)}%)</p></div>
      <button class="btn btn-primary" onclick="$('#newCatForm').style.display='block'">+ Categoría</button>
    </div>
  </div>
  ${newCatForm}
  <div class="grid-3 mb-5">
    <div class="stat-card"><div class="stat-label">Presupuesto</div><div class="stat-value">${money(totalPFijo)}</div></div>
    <div class="stat-card"><div class="stat-label">Gastado</div><div class="stat-value negative">${money(totalGFijo)}</div></div>
    <div class="stat-card"><div class="stat-label">Remanente</div><div class="stat-value ${totalPFijo-totalGFijo>=0?'positive':'negative'}">${money(totalPFijo-totalGFijo)}</div></div>
  </div>
  ${chartHTML}
  <div class="card mb-5">
    <div class="card-title">📅 Gastos Fijos</div>
    <div class="table-container"><table><thead><tr><th>Categoría</th><th>Presupuesto</th><th>Gastado</th><th>Quedan</th><th>Progreso</th><th>%</th><th></th></tr></thead><tbody>${fijoRows}</tbody></table></div>
  </div>
  <div><div class="card-title mb-3">🔁 Periódicos</div>${periodicoRows || '<div class="card"><div class="empty-state" style="padding:20px"><p style="font-size:13px">Sin gastos periódicos</p></div></div>'}</div>`;
}

// ============================================================
// INGRESOS (simplified — no nómina/iguala)
// ============================================================
function viewIngresos() {
  const cm = curMonth();
  const monthIng = state.ingresos.filter(v => v.fecha?.startsWith(cm));
  const totalMes = monthIng.reduce((s,v) => s+Number(v.monto), 0);
  const cardOpts = state.creditCards.map(c => `<option value="${c.id}">${c.tipo_tarjeta==='debito'?'🏧':'💳'} ${c.nombre_display||c.banco}</option>`).join('');

  const typeLabels = { cliente:'🎬 Cliente', freelance:'💻 Freelance', otro:'💵 Otro', nomina:'💼 Nómina', iguala:'🏢 Iguala' };
  const byType = {};
  monthIng.forEach(v => { const k = v.tipo_fuente || 'otro'; byType[k] = (byType[k]||0) + Number(v.monto); });

  // Chart: last 6 months
  const last6 = [];
  for (let i=5; i>=0; i--) {
    const d = new Date(); d.setMonth(d.getMonth()-i);
    const ym = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const total = state.ingresos.filter(v => v.fecha?.startsWith(ym)).reduce((s,v) => s+Number(v.monto), 0);
    last6.push({ month: MONTHS_ES[d.getMonth()], total });
  }
  const maxI = Math.max(...last6.map(m => m.total), 1);
  const bars = last6.map(m => `<div class="chart-col"><div class="chart-val">${m.total>0?moneyShort(m.total):''}</div><div class="chart-bar" style="height:${Math.max(2,(m.total/maxI)*120)}px;background:var(--accent)"></div><div class="chart-label">${m.month}</div></div>`).join('');

  // Templates
  const templates = state.plantillas.map(p => `<button class="btn btn-ghost" onclick="useTemplate('${p.id}')" style="padding:10px 14px"><div style="font-size:18px;margin-bottom:3px">${p.icono}</div><div style="font-size:11px;font-weight:600">${p.nombre}</div>${Number(p.monto_default)>0?`<div style="font-size:10px;color:var(--text-muted)">${money(p.monto_default)}</div>`:''}</button>`).join('');

  // History
  const history = state.ingresos.slice(0,30).map(v => {
    const dest = v.destino === 'efectivo' ? '💵 Efectivo' : getCardLabel(v.destino);
    const typeLbl = typeLabels[v.tipo_fuente] || '💵 Otro';
    return `<tr><td class="mono" style="font-size:11.5px">${fdate(v.fecha)}</td><td style="font-weight:500">${v.fuente||'—'}</td><td><span class="badge badge-neutral">${typeLbl}</span></td><td><span class="badge badge-neutral">${dest}</span></td><td class="text-right mono fw-700" style="color:var(--success)">+${money(v.monto)}</td><td><button class="btn-icon" onclick="deleteIngreso('${v.id}')">🗑</button></td></tr>`;
  }).join('');

  const typeBreakdown = Object.entries(byType).map(([k,v]) => `<div class="flex-between" style="padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px">${typeLabels[k]||k}</span><span class="mono fw-700" style="font-size:12px">${money(v)}</span></div>`).join('');

  return `<div class="page-header"><h2>Ingresos</h2><p>${monthLabel(cm)}</p></div>
  <div class="grid-3 mb-5">
    <div class="stat-card"><div class="stat-label">Ingresos del Mes</div><div class="stat-value positive">${money(totalMes)}</div><div class="stat-sub">${monthIng.length} registros</div></div>
    <div class="stat-card"><div class="stat-label">Promedio (6m)</div><div class="stat-value positive">${money(last6.reduce((s,m)=>s+m.total,0)/6)}</div></div>
    <div class="stat-card"><div class="stat-label">Este Mes</div><div class="stat-value">${monthIng.length}</div></div>
  </div>

  ${templates.length > 0 ? `<div class="card mb-5"><div class="card-title">⚡ Rápido</div><div class="flex gap-2 flex-wrap">${templates}</div></div>` : ''}

  <div class="card mb-5">
    <div class="card-title">Registrar Ingreso</div>
    <div class="grid-2" style="gap:12px">
      <div class="form-group"><label class="form-label">Monto (RD$)</label><input class="form-input" type="number" id="ingMonto" placeholder="0.00" inputmode="decimal"></div>
      <div class="form-group"><label class="form-label">Fuente</label><input class="form-input" id="ingFuente" placeholder="Cliente X, proyecto..."></div>
      <div class="form-group"><label class="form-label">Tipo</label><select class="form-select" id="ingTipo"><option value="cliente">🎬 Cliente</option><option value="freelance">💻 Freelance</option><option value="otro">💵 Otro</option></select></div>
      <div class="form-group"><label class="form-label">Destino</label><select class="form-select" id="ingDestino"><option value="efectivo">💵 Efectivo</option>${cardOpts}</select></div>
      <div class="form-group"><label class="form-label">Fecha</label><input class="form-input" type="date" id="ingFecha" value="${today()}"></div>
      <div class="form-group"><label class="form-label">Nota</label><input class="form-input" id="ingNota" placeholder="Detalle..."></div>
    </div>
    <button class="btn btn-primary mt-4" onclick="addIngreso()">Registrar</button>
  </div>

  <div class="grid-2 mb-5">
    <div class="card"><div class="card-title">Por Tipo</div>${typeBreakdown||'<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Sin datos</div>'}
      <div class="flex-between" style="padding:6px 0;font-weight:700;border-top:2px solid var(--border);margin-top:4px"><span>Total</span><span class="mono" style="color:var(--success)">${money(totalMes)}</span></div>
    </div>
    <div class="card"><div class="card-title">Últimos 6 Meses</div><div class="chart-bars">${bars}</div></div>
  </div>

  <div class="card"><div class="card-title">Historial</div>${history.length>0?`<div class="table-container"><table><thead><tr><th>Fecha</th><th>Fuente</th><th>Tipo</th><th>Destino</th><th class="text-right">Monto</th><th></th></tr></thead><tbody>${history}</tbody></table></div>`:'<div class="empty-state"><div class="empty-icon">💵</div><p>Sin ingresos registrados</p></div>'}</div>`;
}

// ============================================================
// ANALISIS (absorbs Flujo de Caja + Score)
// ============================================================
function viewAnalisis() {
  const cm = curMonth();
  const mtx = state.transactions.filter(t => t.fecha?.startsWith(cm));
  const gastos = getGastosMes();
  const totalIng = getIngresosMes();
  const deudaTC = getDeudaTC();
  const deudaP = getDeudaPrestamos();
  const limTC = state.creditCards.filter(c=>c.tipo_tarjeta!=='debito').reduce((s,c)=>s+Number(c.monto_aprobado),0);
  const liquidez = getLiquidez();
  const tasaUtil = pct(deudaTC, limTC);
  const cuotasMes = state.loans.filter(l=>l.estado!=='pagado'&&l.direccion!=='otorgado').reduce((s,l)=>s+Number(l.cuota_mensual),0);
  const tasaEnd = totalIng > 0 ? pct(cuotasMes, totalIng) : 0;
  const tasaAh = totalIng > 0 ? pct(totalIng - gastos, totalIng) : 0;

  // Score
  let score = 100;
  if (tasaEnd > 40) score -= 30; else if (tasaEnd > 30) score -= 15;
  if (tasaUtil > 50) score -= 20; else if (tasaUtil > 30) score -= 10;
  if (tasaAh < 10) score -= 20; else if (tasaAh < 20) score -= 10;
  if (gastos > totalIng) score -= 20;
  score = clamp(score, 0, 100);
  const hColor = score>=70?'var(--success)':score>=40?'var(--warning)':'var(--danger)';
  const hLabel = score>=70?'Saludable':score>=40?'Atención':'Riesgo';

  // By category
  const byCat = state.budgetCategories.map(cat => ({
    ...cat,
    spent: mtx.filter(t => t.tipo==='gasto' && t.categoria===cat.id).reduce((s,t) => s+Number(t.monto), 0)
  })).filter(c => c.spent > 0).sort((a,b) => b.spent - a.spent);
  const maxS = byCat.length > 0 ? byCat[0].spent : 1;
  const catBars = byCat.map(c => `<div style="margin-bottom:10px"><div class="flex-between" style="margin-bottom:3px"><span style="font-size:12px">${c.icono} ${c.nombre}</span><span class="mono fw-700" style="font-size:12px">${money(c.spent)}</span></div><div class="progress-bar" style="height:5px"><div class="progress-fill" style="width:${pct(c.spent,maxS)}%;background:var(--accent)"></div></div></div>`).join('');

  // By method
  const byMet = {};
  mtx.filter(t => t.tipo==='gasto').forEach(t => { const k=t.metodo_pago||'efectivo'; byMet[k]=(byMet[k]||0)+Number(t.monto); });
  const totalMet = Object.values(byMet).reduce((s,v) => s+v, 0);
  const metBars = Object.entries(byMet).map(([k,v]) => {
    const lab = getCardLabel(k);
    const p = pct(v, totalMet);
    return `<div style="margin-bottom:10px"><div class="flex-between" style="margin-bottom:3px"><span style="font-size:12px">${lab}</span><span class="mono fw-700" style="font-size:12px">${money(v)} <span class="badge badge-neutral">${p.toFixed(0)}%</span></span></div><div class="progress-bar" style="height:5px"><div class="progress-fill" style="width:${p}%;background:var(--accent)"></div></div></div>`;
  }).join('');

  // Flujo de caja projections
  const last3 = [];
  for (let i=2; i>=0; i--) { const d=new Date(); d.setMonth(d.getMonth()-i); last3.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }
  const last3Income = state.ingresos.filter(v => last3.some(m => v.fecha?.startsWith(m)));
  const avgIncome = last3Income.reduce((s,v) => s+Number(v.monto), 0) / 3;
  const budgetT = state.budgetCategories.filter(c=>(c.tipo_gasto||'fijo')!=='periodico').reduce((s,c)=>s+(Number(c.presupuesto_max)||Number(c.presupuesto)||0),0);
  const oblTotal = cuotasMes + budgetT;
  const projs = [30,60,90].map(days => {
    const m = days/30;
    return { days, ing: avgIncome*m, obl: oblTotal*m, net: (avgIncome-oblTotal)*m };
  });

  return `<div class="page-header"><h2>Análisis y Proyección</h2><p>${monthLabel(cm)}</p></div>

  <div class="grid-hero mb-5">
    <div class="card text-center" style="padding:28px">
      <div class="card-title">Salud Financiera</div>
      <div class="mono" style="font-size:56px;font-weight:700;color:${hColor}">${score}</div>
      <div style="font-size:16px;font-weight:600;color:${hColor};margin-bottom:8px">${hLabel}</div>
      <div class="progress-bar" style="height:8px;max-width:250px;margin:0 auto"><div class="progress-fill" style="width:${score}%;background:${hColor}"></div></div>
    </div>
    <div>
      <div class="grid-2" style="gap:12px">
        <div class="stat-card"><div class="stat-label">Endeudamiento</div><div class="stat-value ${tasaEnd>40?'negative':tasaEnd>30?'warning':'positive'}">${tasaEnd.toFixed(1)}%</div><div class="stat-sub">Cuotas / Ingresos</div></div>
        <div class="stat-card"><div class="stat-label">Uso Crédito</div><div class="stat-value ${tasaUtil>50?'negative':tasaUtil>30?'warning':'positive'}">${tasaUtil.toFixed(1)}%</div><div class="stat-sub">Deuda TC / Límite</div></div>
        <div class="stat-card"><div class="stat-label">Tasa Ahorro</div><div class="stat-value ${tasaAh<10?'negative':tasaAh<20?'warning':'positive'}">${tasaAh.toFixed(1)}%</div><div class="stat-sub">(Ing-Gas) / Ing</div></div>
        <div class="stat-card"><div class="stat-label">Liquidez</div><div class="stat-value positive">${money(liquidez)}</div><div class="stat-sub">Débito solamente</div></div>
      </div>
    </div>
  </div>

  <div class="card-title mb-3">📊 Proyección Flujo de Caja</div>
  <div class="grid-3 mb-5">${projs.map(p => `<div class="card">
    <div class="card-title">${p.days} Días</div>
    <div class="flex-between" style="padding:4px 0"><span style="font-size:12px;color:var(--text-secondary)">Ingresos est.</span><span class="mono fw-700" style="font-size:12px;color:var(--success)">${money(p.ing)}</span></div>
    <div class="flex-between" style="padding:4px 0"><span style="font-size:12px;color:var(--text-secondary)">Obligaciones</span><span class="mono fw-700" style="font-size:12px;color:var(--danger)">${money(p.obl)}</span></div>
    <div style="border-top:2px solid var(--border);margin-top:6px;padding-top:6px"><div class="flex-between"><span class="fw-700" style="font-size:13px">Neto</span><span class="mono fw-700" style="font-size:16px;color:${p.net>=0?'var(--success)':'var(--danger)'}">${money(p.net)}</span></div></div>
  </div>`).join('')}</div>

  <div class="grid-2 mb-5">
    <div class="card"><div class="card-title">Gastos por Categoría</div>${catBars || '<div class="empty-state" style="padding:16px"><p style="font-size:12px">Sin datos</p></div>'}</div>
    <div class="card"><div class="card-title">Gastos por Método</div>${metBars || '<div class="empty-state" style="padding:16px"><p style="font-size:12px">Sin datos</p></div>'}</div>
  </div>

  <div class="card">
    <div class="card-title">Ingresos vs Gastos</div>
    <div class="grid-2" style="gap:20px">
      <div><div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">Ingresos</div><div style="height:20px;background:var(--success);border-radius:4px;position:relative"><span style="position:absolute;right:6px;top:2px;font-size:11px;font-weight:700;color:white">${money(totalIng)}</span></div></div>
      <div><div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px">Gastos</div><div style="height:20px;background:var(--danger);border-radius:4px;position:relative;width:${totalIng>0?Math.max(10,gastos/totalIng*100):0}%"><span style="position:absolute;right:6px;top:2px;font-size:11px;font-weight:700;color:white">${money(gastos)}</span></div></div>
    </div>
    ${totalIng > 0 ? `<div style="margin-top:14px;font-size:13px;color:var(--text-secondary)">Gastas el <strong style="color:${gastos/totalIng>0.8?'var(--danger)':'var(--text-primary)'}">${((gastos/totalIng)*100).toFixed(1)}%</strong> de tus ingresos. ${gastos/totalIng<0.7?'¡Buen control! 👏':gastos/totalIng<0.9?'Podrías optimizar.':'⚠️ Gastos altos.'}</div>` : ''}
  </div>`;
}

// ============================================================
// ACTIONS
// ============================================================
async function addTransaction() {
  const monto = Number($('#txMonto')?.value);
  if (!monto || monto <= 0) return;
  const cat = $('#txCat')?.value;
  const metodo = $('#txMetodo')?.value;
  const fecha = $('#txFecha')?.value;
  const desc = $('#txDesc')?.value;

  await db.from('transactions').insert({ monto, descripcion: desc, categoria: cat, metodo_pago: metodo, tipo: 'gasto', fecha });

  // Update card balance
  if (metodo !== 'efectivo') {
    const cc = state.creditCards.find(c => c.id === metodo);
    if (cc) {
      const isDebit = cc.tipo_tarjeta === 'debito';
      const newSaldo = isDebit ? Math.max(0, Number(cc.saldo_actual) - monto) : Number(cc.saldo_actual) + monto;
      await db.from('credit_cards').update({ saldo_actual: newSaldo }).eq('id', metodo);
    }
  }
  await loadAll(); render();
}

// Quick Transaction from FAB
function openQuickTx() {
  const catOpts = state.budgetCategories.map(c => `<option value="${c.id}">${c.icono} ${c.nombre}</option>`).join('');
  const cardOpts = state.creditCards.map(c => `<option value="${c.id}">${c.tipo_tarjeta==='debito'?'🏧':'💳'} ${c.nombre_display||c.banco}</option>`).join('');

  const html = `<div class="quick-tx-modal" id="quickTxModal" onclick="if(event.target===this)this.remove()">
    <div class="quick-tx-body">
      <div class="quick-tx-handle"></div>
      <div style="font-size:16px;font-weight:700;margin-bottom:16px">Nuevo Gasto</div>
      <div class="form-group"><label class="form-label">Monto</label><input class="form-input" type="number" id="qtxMonto" placeholder="0.00" inputmode="decimal" style="font-size:20px;font-weight:700;text-align:center;padding:14px" autofocus></div>
      <div class="grid-2" style="gap:10px">
        <div class="form-group"><label class="form-label">Categoría</label><select class="form-select" id="qtxCat">${catOpts}</select></div>
        <div class="form-group"><label class="form-label">Método</label><select class="form-select" id="qtxMetodo"><option value="efectivo">💵 Efectivo</option>${cardOpts}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Descripción</label><input class="form-input" id="qtxDesc" placeholder="¿En qué gastaste?"></div>
      <button class="btn btn-primary" onclick="submitQuickTx()" style="width:100%;justify-content:center;padding:12px;font-size:15px;margin-top:8px">Registrar</button>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(() => $('#qtxMonto')?.focus(), 100);
}

async function submitQuickTx() {
  const monto = Number($('#qtxMonto')?.value);
  if (!monto || monto <= 0) return;
  const cat = $('#qtxCat')?.value;
  const metodo = $('#qtxMetodo')?.value;
  const desc = $('#qtxDesc')?.value;

  await db.from('transactions').insert({ monto, descripcion: desc, categoria: cat, metodo_pago: metodo, tipo: 'gasto', fecha: today() });

  if (metodo !== 'efectivo') {
    const cc = state.creditCards.find(c => c.id === metodo);
    if (cc) {
      const isDebit = cc.tipo_tarjeta === 'debito';
      const newSaldo = isDebit ? Math.max(0, Number(cc.saldo_actual) - monto) : Number(cc.saldo_actual) + monto;
      await db.from('credit_cards').update({ saldo_actual: newSaldo }).eq('id', metodo);
    }
  }
  $('#quickTxModal')?.remove();
  await loadAll(); render();
}

// Pay to credit card (new feature)
async function payTC(ccId) {
  const monto = Number($(`#payTC-${ccId}`)?.value);
  if (!monto || monto <= 0) return;
  const fromId = $(`#payTCFrom-${ccId}`)?.value;

  // Reduce TC balance
  const cc = state.creditCards.find(c => c.id === ccId);
  if (cc) {
    await db.from('credit_cards').update({ saldo_actual: Math.max(0, Number(cc.saldo_actual) - monto) }).eq('id', ccId);
  }

  // If paid from debit card, reduce debit balance
  if (fromId !== 'efectivo') {
    const debit = state.creditCards.find(c => c.id === fromId);
    if (debit) {
      await db.from('credit_cards').update({ saldo_actual: Math.max(0, Number(debit.saldo_actual) - monto) }).eq('id', fromId);
    }
  }

  // Record as transaction
  await db.from('transactions').insert({
    monto, descripcion: `Pago a ${cc?.nombre_display || 'TC'}`,
    categoria: null, metodo_pago: fromId, tipo: 'pago-tc', fecha: today()
  });

  await loadAll(); render();
}

async function deleteTx(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  if (tx.metodo_pago !== 'efectivo') {
    const cc = state.creditCards.find(c => c.id === tx.metodo_pago);
    if (cc) {
      const isDebit = cc.tipo_tarjeta === 'debito';
      const newSaldo = tx.tipo === 'gasto'
        ? (isDebit ? Number(cc.saldo_actual) + Number(tx.monto) : Math.max(0, Number(cc.saldo_actual) - Number(tx.monto)))
        : Number(cc.saldo_actual) + Number(tx.monto);
      await db.from('credit_cards').update({ saldo_actual: newSaldo }).eq('id', tx.metodo_pago);
    }
  }
  await db.from('transactions').delete().eq('id', id);
  await loadAll(); render();
}

async function payLoan(id) {
  const loan = state.loans.find(l => l.id === id);
  if (!loan) return;
  await db.from('loan_payments').insert({ loan_id: id, monto: Number(loan.cuota_mensual), fecha: today() });
  await db.from('loans').update({ monto_adeudado: Math.max(0, Number(loan.monto_adeudado) - Number(loan.cuota_mensual)) }).eq('id', id);
  await loadAll(); render();
}

async function payLoanExtra(id) {
  const monto = Number($(`#extra-${id}`)?.value);
  if (!monto || monto <= 0) return;
  const loan = state.loans.find(l => l.id === id);
  if (!loan) return;
  await db.from('loan_payments').insert({ loan_id: id, monto, fecha: today() });
  await db.from('loans').update({ monto_adeudado: Math.max(0, Number(loan.monto_adeudado) - monto) }).eq('id', id);
  await loadAll(); render();
}

async function changeCuota(id, current) {
  const newCuota = prompt('Nueva cuota mensual:', current);
  if (newCuota && Number(newCuota) > 0) {
    await db.from('loans').update({ cuota_mensual: Number(newCuota) }).eq('id', id);
    await loadAll(); render();
  }
}

function toggleLoanFields() {
  const show = $('#nlDir')?.value === 'otorgado';
  if ($('#nlPersonaGrp')) $('#nlPersonaGrp').style.display = show ? 'block' : 'none';
  if ($('#nlContactoGrp')) $('#nlContactoGrp').style.display = show ? 'block' : 'none';
}

function toggleCuotaField() {
  const unico = $('#nlPagoTipo')?.value === 'unico';
  if ($('#nlCuotaGrp')) $('#nlCuotaGrp').style.display = unico ? 'none' : 'block';
  if ($('#nlDiaGrp')) $('#nlDiaGrp').style.display = unico ? 'none' : 'block';
}

async function saveNewLoan() {
  const nombre = $('#nlNombre')?.value.trim();
  if (!nombre) return alert('Ingresa un nombre');
  const dir = $('#nlDir').value;
  const monto = Number($('#nlMonto').value) || 0;
  const adeudado = Number($('#nlAdeudado').value) || monto;
  const pagoUnico = $('#nlPagoTipo').value === 'unico';
  const cuota = pagoUnico ? 0 : (Number($('#nlCuota').value) || 0);
  const tasa = Number($('#nlTasa').value) || 0;
  const dia = pagoUnico ? null : (Number($('#nlDia').value) || null);
  const venc = $('#nlVenc').value || null;
  const persona = dir==='otorgado' ? $('#nlPersona').value.trim() : null;
  const contacto = dir==='otorgado' ? $('#nlContacto').value.trim() : null;
  const id = nombre.toLowerCase().replace(/\s+/g,'-').substring(0,20)+'-'+Date.now().toString(36);

  await db.from('loans').insert({
    id, nombre, monto_original: monto, monto_adeudado: adeudado, tasa,
    cuota_mensual: cuota, dia_pago: dia, fecha_finalizacion: venc, fecha_vencimiento: venc,
    tipo: 'prestamo', direccion: dir, persona, contacto, estado: 'activo', pago_unico: pagoUnico
  });
  await loadAll(); render();
}

async function deleteLoan(id) {
  if (!confirm('¿Eliminar este préstamo y su historial?')) return;
  await db.from('loan_payments').delete().eq('loan_id', id);
  await db.from('loans').delete().eq('id', id);
  await loadAll(); render();
}

async function markLoanStatus(id, status) {
  if (!confirm(`¿Marcar como ${status}?`)) return;
  const updates = { estado: status };
  if (status === 'pagado') updates.monto_adeudado = 0;
  await db.from('loans').update(updates).eq('id', id);
  await loadAll(); render();
}

async function editLoan(id) {
  const loan = state.loans.find(l => l.id === id);
  if (!loan) return;
  const isOtorgado = loan.direccion === 'otorgado';
  const html = `<div class="modal-overlay" id="editLoanModal" onclick="if(event.target===this)this.remove()">
    <div class="modal-body">
      <h3 style="font-size:17px;font-weight:700;margin-bottom:18px">Editar: ${loan.nombre}</h3>
      <div class="grid-2" style="gap:12px">
        <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="elNombre" value="${loan.nombre}"></div>
        <div class="form-group"><label class="form-label">Dirección</label><select class="form-select" id="elDir"><option value="tomado" ${!isOtorgado?'selected':''}>Tomado</option><option value="otorgado" ${isOtorgado?'selected':''}>Otorgado</option></select></div>
        ${isOtorgado?`<div class="form-group"><label class="form-label">Persona</label><input class="form-input" id="elPersona" value="${loan.persona||''}"></div><div class="form-group"><label class="form-label">Contacto</label><input class="form-input" id="elContacto" value="${loan.contacto||''}"></div>`:`<input type="hidden" id="elPersona" value=""><input type="hidden" id="elContacto" value="">`}
        <div class="form-group"><label class="form-label">Monto Original</label><input class="form-input" type="number" id="elMontoOrig" value="${loan.monto_original||''}"></div>
        <div class="form-group"><label class="form-label">Adeudado</label><input class="form-input" type="number" id="elAdeudado" value="${loan.monto_adeudado}"></div>
        <div class="form-group"><label class="form-label">Cuota</label><input class="form-input" type="number" id="elCuota" value="${loan.cuota_mensual||''}"></div>
        <div class="form-group"><label class="form-label">Tasa %</label><input class="form-input" type="number" id="elTasa" value="${loan.tasa||0}"></div>
        <div class="form-group"><label class="form-label">Día Pago</label><input class="form-input" type="number" id="elDia" value="${loan.dia_pago||''}" min="1" max="31"></div>
        <div class="form-group"><label class="form-label">Estado</label><select class="form-select" id="elEstado"><option value="activo" ${loan.estado==='activo'?'selected':''}>Activo</option><option value="pagado" ${loan.estado==='pagado'?'selected':''}>Pagado</option><option value="mora" ${loan.estado==='mora'?'selected':''}>Mora</option></select></div>
        <div class="form-group"><label class="form-label">Vencimiento</label><input class="form-input" type="date" id="elVenc" value="${loan.fecha_vencimiento||loan.fecha_finalizacion||''}"></div>
      </div>
      <div class="flex gap-2" style="justify-content:flex-end;margin-top:18px">
        <button class="btn btn-ghost" onclick="$('#editLoanModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveEditLoan('${id}')">💾 Guardar</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function saveEditLoan(id) {
  await db.from('loans').update({
    nombre: $('#elNombre').value.trim(),
    direccion: $('#elDir').value,
    persona: $('#elPersona').value.trim() || null,
    contacto: $('#elContacto').value.trim() || null,
    monto_original: Number($('#elMontoOrig').value) || null,
    monto_adeudado: Number($('#elAdeudado').value) || 0,
    cuota_mensual: Number($('#elCuota').value) || 0,
    tasa: Number($('#elTasa').value) || 0,
    dia_pago: Number($('#elDia').value) || null,
    estado: $('#elEstado').value,
    fecha_vencimiento: $('#elVenc').value || null,
    fecha_finalizacion: $('#elVenc').value || null,
  }).eq('id', id);
  $('#editLoanModal')?.remove();
  await loadAll(); render();
}

// Budget
let _budgetTimer = null;
async function updateBudgetRange(catId, field, value) {
  const v = Number(value) || 0;
  state.budgetCategories = state.budgetCategories.map(c =>
    c.id === catId ? { ...c, presupuesto_max: v, presupuesto: v } : c
  );
  clearTimeout(_budgetTimer);
  _budgetTimer = setTimeout(async () => {
    await db.from('budget_categories').update({ presupuesto_max: v, presupuesto: v }).eq('id', catId);
  }, 600);
}

async function deleteCat(catId) {
  if (!confirm('¿Eliminar categoría?')) return;
  await db.from('budget_categories').delete().eq('id', catId);
  await loadAll(); render();
}

async function saveNewCategory() {
  const emoji = $('#ncEmoji')?.value.trim() || '📦';
  const nombre = $('#ncNombre')?.value.trim();
  if (!nombre) return alert('Ingresa un nombre');
  const tipo = $('#ncTipoGasto').value;
  const monto = Number($('#ncMontoInit').value) || 0;
  const id = nombre.toLowerCase().replace(/[^a-z0-9]/g,'-').substring(0,25)+'-'+Date.now().toString(36);

  await db.from('budget_categories').insert({
    id, nombre, icono: emoji, orden: state.budgetCategories.length + 1,
    tipo_gasto: tipo, frecuencia: tipo==='fijo' ? 'mensual' : 'periodico',
    presupuesto: tipo==='fijo' ? monto : 0, presupuesto_max: tipo==='fijo' ? monto : 0,
    monto_total: tipo==='periodico' ? monto : 0
  });
  await loadAll(); render();
}

// Ingresos
async function addIngreso() {
  const monto = Number($('#ingMonto')?.value);
  if (!monto || monto <= 0) return;
  const fuente = $('#ingFuente').value.trim();
  const tipo_fuente = $('#ingTipo').value;
  const destino = $('#ingDestino').value;
  const fecha = $('#ingFecha').value;
  const nota = $('#ingNota').value.trim();

  await db.from('ingresos').insert({ monto, fuente: fuente || tipo_fuente, tipo_fuente, destino, fecha, nota: nota || null });

  if (destino !== 'efectivo') {
    const cc = state.creditCards.find(c => c.id === destino);
    if (cc) {
      await db.from('credit_cards').update({ saldo_actual: Number(cc.saldo_actual) + monto }).eq('id', destino);
    }
  }
  await loadAll(); render();
}

async function deleteIngreso(id) {
  const ing = state.ingresos.find(v => v.id === id);
  if (!ing) return;
  if (ing.destino && ing.destino !== 'efectivo') {
    const cc = state.creditCards.find(c => c.id === ing.destino);
    if (cc) {
      await db.from('credit_cards').update({ saldo_actual: Math.max(0, Number(cc.saldo_actual) - Number(ing.monto)) }).eq('id', ing.destino);
    }
  }
  await db.from('ingresos').delete().eq('id', id);
  await loadAll(); render();
}

function useTemplate(templateId) {
  const pl = state.plantillas.find(p => p.id === templateId);
  if (!pl) return;
  if ($('#ingMonto') && Number(pl.monto_default) > 0) $('#ingMonto').value = pl.monto_default;
  if ($('#ingFuente')) $('#ingFuente').value = pl.fuente || '';
  if ($('#ingTipo')) $('#ingTipo').value = pl.tipo_fuente || 'otro';
  if ($('#ingDestino') && pl.destino_default) $('#ingDestino').value = pl.destino_default;
  $('#ingMonto')?.focus();
}

// Card management
async function adjustCardBalance(id) {
  const val = Number($(`#adj-${id}`)?.value);
  if (isNaN(val) || val < 0) return;
  await db.from('credit_cards').update({ saldo_actual: val }).eq('id', id);
  await loadAll(); render();
}

function toggleCardFields() {
  const isCredit = $('#ncTipo')?.value === 'credito';
  $$('.ncCreditField').forEach(el => el.style.display = isCredit ? 'block' : 'none');
  $$('.ncDebitField').forEach(el => el.style.display = isCredit ? 'none' : 'block');
}

async function saveNewCard() {
  const banco = $('#ncBanco')?.value.trim();
  if (!banco) return alert('Ingresa el banco');
  const tipo = $('#ncTipo').value;
  const isCredit = tipo === 'credito';
  const color = $('#ncColor').value || '#2d5a27';
  const saldo = Number($('#ncSaldo').value) || 0;
  const id = banco.toLowerCase().replace(/\s+/g,'-')+'-'+Date.now().toString(36);

  let fechaVenc = null;
  if (!isCredit) {
    const mes = $('#ncVencMes')?.value;
    const anio = $('#ncVencAnio')?.value;
    if (mes && anio) fechaVenc = `${anio}-${mes}-01`;
  }

  try {
    const { error } = await db.from('credit_cards').insert({
      id, banco, tipo_tarjeta: tipo, nombre_display: (isCredit?'TC ':'TD ')+banco,
      saldo_actual: saldo, color,
      monto_aprobado: isCredit ? (Number($('#ncLimite').value)||0) : 0,
      monto_sobregiro: isCredit ? (Number($('#ncSobregiro').value)||0) : 0,
      fecha_corte: isCredit ? (Number($('#ncCorte').value)||1) : 1,
      dias_limite_pago: isCredit ? (Number($('#ncDiasPago').value)||25) : 0,
      fecha_vencimiento: fechaVenc,
    });
    if (error) { alert('Error: '+error.message); return; }
    await loadAll(); render();
  } catch(e) { alert('Error: '+e.message); }
}

async function deleteCard(id) {
  if (!confirm('¿Eliminar esta tarjeta?')) return;
  await db.from('credit_cards').delete().eq('id', id);
  await loadAll(); render();
}

function showEditCard(id) {
  const cc = state.creditCards.find(c => c.id === id);
  if (!cc) return;
  const isCredit = cc.tipo_tarjeta !== 'debito';
  const curColor = cc.color || '#2d5a27';
  const colors = ['#2d5a27','#1a3a6b','#8b0000','#4a4a4a','#1a1a1a','#6b3fa0','#c0392b','#2980b9','#d4a017','#16a085','#e67e22','#7f8c8d'];
  const colorPicker = colors.map(c => `<div onclick="document.getElementById('ecColor').value='${c}';document.getElementById('ecColorPrev').style.background='${c}'" style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c===curColor?'white':'var(--border)'}"></div>`).join('');

  const html = `<div class="modal-overlay" id="editCardModal" onclick="if(event.target===this)this.remove()">
    <div class="modal-body">
      <h3 style="font-size:17px;font-weight:700;margin-bottom:18px">Editar ${cc.nombre_display||cc.banco}</h3>
      <div class="form-group"><label class="form-label">Banco</label><input class="form-input" id="ecBanco" value="${cc.banco}"></div>
      <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="ecDisplay" value="${cc.nombre_display||''}"></div>
      <div class="form-group"><label class="form-label">Tipo</label><select class="form-select" id="ecTipo"><option value="credito" ${isCredit?'selected':''}>Crédito</option><option value="debito" ${!isCredit?'selected':''}>Débito</option></select></div>
      <div class="form-group"><label class="form-label">Color</label><div class="flex gap-2 flex-wrap" style="margin-bottom:4px">${colorPicker}</div><input type="hidden" id="ecColor" value="${curColor}"><div id="ecColorPrev" style="width:100%;height:6px;border-radius:3px;background:${curColor}"></div></div>
      <div class="grid-2" style="gap:12px">
        <div class="form-group"><label class="form-label">Saldo</label><input class="form-input" type="number" id="ecSaldo" value="${cc.saldo_actual}"></div>
        ${isCredit ? `
          <div class="form-group"><label class="form-label">Límite</label><input class="form-input" type="number" id="ecLimite" value="${cc.monto_aprobado}"></div>
          <div class="form-group"><label class="form-label">Sobregiro</label><input class="form-input" type="number" id="ecSobregiro" value="${cc.monto_sobregiro}"></div>
          <div class="form-group"><label class="form-label">Día Corte</label><input class="form-input" type="number" id="ecCorte" value="${cc.fecha_corte}" min="1" max="31"></div>
          <div class="form-group"><label class="form-label">Días Pago</label><input class="form-input" type="number" id="ecDiasPago" value="${cc.dias_limite_pago}"></div>
        ` : `
          <div class="form-group"><label class="form-label">Vencimiento</label><div class="flex gap-2"><select class="form-select" id="ecVencMes" style="width:80px">${[...Array(12)].map((_,i)=>{const m=String(i+1).padStart(2,'0');return `<option value="${m}" ${cc.fecha_vencimiento?.substring(5,7)===m?'selected':''}>${m}</option>`;}).join('')}</select><input class="form-input" type="number" id="ecVencAnio" value="${cc.fecha_vencimiento?cc.fecha_vencimiento.substring(0,4):''}" placeholder="2028" style="width:80px"></div></div>
        `}
      </div>
      <div class="flex gap-2" style="justify-content:flex-end;margin-top:18px">
        <button class="btn btn-ghost" onclick="$('#editCardModal').remove()">Cancelar</button>
        <button class="btn btn-primary" onclick="saveEditCard('${cc.id}',${isCredit})">💾 Guardar</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

async function saveEditCard(id, isCredit) {
  const data = {
    banco: $('#ecBanco').value.trim(),
    nombre_display: $('#ecDisplay').value.trim(),
    tipo_tarjeta: $('#ecTipo').value,
    saldo_actual: Number($('#ecSaldo').value) || 0,
    color: $('#ecColor').value || '#2d5a27',
  };
  if (isCredit) {
    data.monto_aprobado = Number($('#ecLimite').value) || 0;
    data.monto_sobregiro = Number($('#ecSobregiro').value) || 0;
    data.fecha_corte = Number($('#ecCorte').value) || 1;
    data.dias_limite_pago = Number($('#ecDiasPago').value) || 25;
  } else {
    const mes = $('#ecVencMes')?.value;
    const anio = $('#ecVencAnio')?.value;
    data.fecha_vencimiento = (mes && anio) ? `${anio}-${mes}-01` : null;
  }
  await db.from('credit_cards').update(data).eq('id', id);
  $('#editCardModal')?.remove();
  await loadAll(); render();
}

async function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  await db.from('settings').upsert({ key: 'theme', value: state.theme });
  render();
}

// ============================================================
// EVENT BINDING
// ============================================================
function bindEvents() {
  $$('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      state.section = el.dataset.nav;
      closeMenu();
      render();
      window.scrollTo(0, 0);
    });
  });
  const themeBtn = $('#themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const menuToggle = $('#menuToggle');
  if (menuToggle) menuToggle.addEventListener('click', openMenu);
  const menuClose = $('#menuClose');
  if (menuClose) menuClose.addEventListener('click', closeMenu);
  const menuOverlay = $('#menuOverlay');
  if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);
  const fab = $('#fabTx');
  if (fab) fab.addEventListener('click', openQuickTx);
}

function openMenu() {
  $('#slideMenu')?.classList.add('open');
  $('#menuOverlay')?.classList.add('open');
}
function closeMenu() {
  $('#slideMenu')?.classList.remove('open');
  $('#menuOverlay')?.classList.remove('open');
}

// ============================================================
// AUTH / LOGIN
// ============================================================
function renderLogin(error = '') {
  const app = $('#app');
  app.className = '';
  app.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg-primary);padding:20px">
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:36px;width:100%;max-width:360px;box-shadow:var(--shadow-md)">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:44px;margin-bottom:6px">💰</div>
          <h1 style="font-family:var(--font-mono);font-size:20px;font-weight:700;color:var(--accent);margin-bottom:3px">FinanzasRD</h1>
          <p style="font-size:12px;color:var(--text-muted)">Ingresa para acceder</p>
        </div>
        ${error ? `<div style="background:var(--danger-light);color:var(--danger);padding:10px 12px;border-radius:8px;font-size:12px;margin-bottom:14px;border:1px solid #c0392b33">❌ ${error}</div>` : ''}
        <div class="form-group">
          <label class="form-label">Usuario</label>
          <input class="form-input" id="loginUser" placeholder="usuario" autocomplete="username" style="font-size:15px">
        </div>
        <div class="form-group">
          <label class="form-label">Contraseña</label>
          <input class="form-input" id="loginPass" type="password" placeholder="••••••••" autocomplete="current-password" style="font-size:15px">
        </div>
        <button class="btn btn-primary" onclick="doLogin()" style="width:100%;justify-content:center;padding:12px;font-size:15px;margin-top:8px">Entrar</button>
      </div>
    </div>`;
  setTimeout(() => {
    $('#loginPass')?.addEventListener('keydown', e => { if (e.key==='Enter') doLogin(); });
    $('#loginUser')?.addEventListener('keydown', e => { if (e.key==='Enter') $('#loginPass')?.focus(); });
    $('#loginUser')?.focus();
  }, 100);
}

async function doLogin() {
  const user = $('#loginUser')?.value.trim().toLowerCase();
  const pass = $('#loginPass')?.value;
  if (!user || !pass) return renderLogin('Ingresa usuario y contraseña');
  const { data, error } = await db.auth.signInWithPassword({ email: user+'@finanzasrd.app', password: pass });
  if (error) return renderLogin('Usuario o contraseña incorrectos');
  state.user = data.user;
  await loadAll();
  render();
}

async function doLogout() {
  await db.auth.signOut();
  state.user = null;
  renderLogin();
}

// ============================================================
// INIT
// ============================================================
async function init() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      state.user = session.user;
      await loadAll();
      render();
    } else {
      renderLogin();
    }
  } catch(e) {
    console.error('Error:', e);
    renderLogin('Error conectando con el servidor');
  }
}

init();
