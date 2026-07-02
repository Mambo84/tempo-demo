import React, { useState, useEffect, useMemo } from 'react';
import { Activity, Users, ChevronRight, Plus, Check, AlertCircle, TrendingUp, TrendingDown, Minus, X, ArrowLeft, FileText, Filter } from 'lucide-react';
import { signUp, signInWithPassword, signOut, getSession, onAuthStateChange } from './lib/auth';
import { getMyAthlete, createAthlete, updateWellnessSettings } from './lib/data/athletes';
import * as WorkoutsData from './lib/data/workouts';
import * as WellnessData from './lib/data/wellness';

// ============================================================
// Demo configuration
// Change FEEDBACK_EMAIL to your real address before sending to testers.
// ============================================================
const FEEDBACK_EMAIL = 'feedback@example.com';
const DEMO_VERSION = 'v0.4';

// ============================================================
// Storage helpers - persistent across sessions
// ============================================================
const storage = {
  async get(key, fallback = null) {
    try {
      const r = await window.storage.get(key);
      return r ? JSON.parse(r.value) : fallback;
    } catch { return fallback; }
  },
  async set(key, value) {
    try { await window.storage.set(key, JSON.stringify(value)); } catch {}
  }
};

// ============================================================
// Load calculations - real, not faked
// ============================================================
const calc = {
  sessionLoad: (rpe, durationMin) => Math.round((rpe || 0) * (durationMin || 0)),

  dailyLoad: (workouts, dateStr) =>
    workouts.filter(w => w.date === dateStr)
      .reduce((sum, w) => sum + calc.sessionLoad(w.rpe, w.duration), 0),

  weeklyLoad: (workouts, endDate) => {
    const end = new Date(endDate);
    let total = 0;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const dl = calc.dailyLoad(workouts, ds);
      days.push({ date: ds, load: dl });
      total += dl;
    }
    return { total, days };
  },

  // Acute (7d) / Chronic (28d) workload ratio
  acwr: (workouts, endDate) => {
    const end = new Date(endDate);
    let acute = 0, chronic = 0;
    for (let i = 0; i < 28; i++) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const dl = calc.dailyLoad(workouts, d.toISOString().slice(0, 10));
      chronic += dl;
      if (i < 7) acute += dl;
    }
    const acuteAvg = acute / 7;
    const chronicAvg = chronic / 28;
    if (chronicAvg === 0) return null;
    return acuteAvg / chronicAvg;
  },

  monotony: (workouts, endDate) => {
    const { days } = calc.weeklyLoad(workouts, endDate);
    const loads = days.map(d => d.load);
    const mean = loads.reduce((a, b) => a + b, 0) / 7;
    if (mean === 0) return null;
    const variance = loads.reduce((s, l) => s + Math.pow(l - mean, 2), 0) / 7;
    const sd = Math.sqrt(variance);
    if (sd === 0) return mean > 0 ? 999 : null;
    return mean / sd;
  },

  strain: (workouts, endDate) => {
    const wl = calc.weeklyLoad(workouts, endDate).total;
    const mon = calc.monotony(workouts, endDate);
    return mon ? Math.round(wl * mon) : null;
  },

  wellnessAvg: (checkins, days = 7, endDate) => {
    const end = new Date(endDate);
    const cutoff = new Date(end);
    cutoff.setDate(end.getDate() - days + 1);
    const recent = checkins.filter(c => {
      const cd = new Date(c.date);
      return cd >= cutoff && cd <= end;
    });
    if (!recent.length) return null;
    const fields = ['fatigue', 'soreness', 'sleep', 'stress', 'mood', 'motivation'];
    const sum = recent.reduce((s, c) =>
      s + fields.reduce((fs, f) => fs + (c[f] || 0), 0), 0);
    return sum / (recent.length * fields.length);
  }
};

// ============================================================
// Date helpers
// ============================================================
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (ds) => {
  const d = new Date(ds);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
};
const fmtShort = (ds) => {
  const d = new Date(ds);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

// ============================================================
// ============================================================
// Test catalog — evidence-grounded test definitions
// Used by entry forms and result rendering across the app
// ============================================================
const TEST_CATALOG = [
  // ===== AEROBIC / ENDURANCE =====
  { key: 'yyir1',     name: 'Yo-Yo IR1',           cat: 'Aerobic',  unit: 'm',      better: 'higher', brief: 'Intermittent recovery test. Score = total distance covered. Highly reliable for team-sport aerobic capacity.' },
  { key: 'ift_30_15', name: '30-15 IFT',           cat: 'Aerobic',  unit: 'km/h',   better: 'higher', brief: 'Buchheit intermittent fitness test. Records VIFT at final completed stage. Used to prescribe HIIT.' },
  { key: 'tt_2k',     name: '2km time trial',      cat: 'Aerobic',  unit: 'mm:ss',  better: 'lower',  brief: 'Continuous run for time. AFL combine standard since 2017.' },
  { key: 'beep',      name: 'Beep test',           cat: 'Aerobic',  unit: 'level',  better: 'higher', brief: '20m multi-stage shuttle run. Older standard, still common at club level.' },

  // ===== SPEED =====
  { key: 'sprint_10', name: '10m sprint',          cat: 'Speed',    unit: 's',      better: 'lower',  brief: 'Acceleration. Standing start, electronic timing recommended.' },
  { key: 'sprint_20', name: '20m sprint',          cat: 'Speed',    unit: 's',      better: 'lower',  brief: 'AFL standard. Captures acceleration + early top-end speed.' },
  { key: 'sprint_40', name: '40m sprint',          cat: 'Speed',    unit: 's',      better: 'lower',  brief: 'Captures max velocity phase. Often split into 10/20/40 intervals.' },
  { key: 'flying_20', name: 'Flying 20m',          cat: 'Speed',    unit: 's',      better: 'lower',  brief: '20m timed after a flying start. Pure top-speed measure.' },

  // ===== AGILITY =====
  { key: 'agility_505',   name: '505 agility',     cat: 'Agility',  unit: 's',      better: 'lower',  brief: 'Single change-of-direction speed. Sprint 10m, plant, sprint 5m back.' },
  { key: 'agility_afl',   name: 'AFL agility',     cat: 'Agility',  unit: 's',      better: 'lower',  brief: 'AFL combine standard. Weaves between poles.' },
  { key: 'agility_ill',   name: 'Illinois agility',cat: 'Agility',  unit: 's',      better: 'lower',  brief: '60s mixed COD course over 10m × 5m.' },
  { key: 'agility_ttest', name: 'T-test',          cat: 'Agility',  unit: 's',      better: 'lower',  brief: 'Forward, lateral and backward shuffle. Multi-direction agility.' },

  // ===== POWER =====
  { key: 'cmj',       name: 'Countermovement jump', cat: 'Power',   unit: 'cm',     better: 'higher', brief: 'Most reliable lower-body power test. Force-plate gold standard; jump mat acceptable.' },
  { key: 'sj',        name: 'Squat jump',           cat: 'Power',   unit: 'cm',     better: 'higher', brief: 'Concentric only — no countermovement. CMJ:SJ ratio indicates SSC utilisation.' },
  { key: 'broad',     name: 'Broad jump',           cat: 'Power',   unit: 'cm',     better: 'higher', brief: 'Horizontal power. Two-foot take-off and landing.' },
  { key: 'dj_rsi',    name: 'Drop jump RSI',        cat: 'Power',   unit: 'ratio',  better: 'higher', brief: 'Reactive Strength Index = jump height / contact time. Drop from 30cm box.' },

  // ===== STRENGTH =====
  { key: '1rm_squat', name: '1RM back squat',       cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Lower-body max strength. Use estimated 1RM from 3-5RM if true 1RM not practical.' },
  { key: '1rm_bench', name: '1RM bench press',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Upper-body pressing max strength.' },
  { key: '1rm_tbdl',  name: '1RM trap-bar DL',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Triple extension max strength. Lower technical demand than back squat.' },
  { key: 'chinup_max',name: 'Chin-up max reps',     cat: 'Strength',unit: 'reps',   better: 'higher', brief: 'Bodyweight chin-up endurance. Strict form, no kipping.' },
  { key: 'nordic',    name: 'Nordic hamstring',     cat: 'Strength',unit: 'N',      better: 'higher', brief: 'Eccentric knee flexor strength. NordBord or load cell. <256N flagged as elevated risk.' },
  { key: 'imtp',      name: 'Isometric mid-thigh pull', cat: 'Strength', unit: 'N', better: 'higher', brief: 'Maximal isometric force. Force plate required.' },
  { key: 'iso_add',   name: 'Isometric adductor',   cat: 'Strength',unit: 'N',      better: 'higher', brief: 'Hip adductor strength. ForceFrame or sphygmomanometer. Asymmetry flagged for groin risk.' },
  { key: 'iso_abd',   name: 'Isometric abductor',   cat: 'Strength',unit: 'N',      better: 'higher', brief: 'Hip abductor strength. Often paired with adductor for adductor:abductor ratio (>0.9 is healthy).' },
  // ----- Barbell lifts (1RM) -----
  { key: 'sq_1rm',    name: 'Back squat 1RM',       cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'One-rep maximum. Below parallel. Belt allowed; suit/wraps not.' },
  { key: 'sq_3rm',    name: 'Back squat 3RM',       cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Three-rep max. Common in-season test — lower CNS demand than 1RM.' },
  { key: 'sq_5rm',    name: 'Back squat 5RM',       cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Five-rep max. Estimates 1RM at ~87% (Epley/Brzycki).' },
  { key: 'fsq_1rm',   name: 'Front squat 1RM',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Anterior load. Typically 80–85% of back squat 1RM.' },
  { key: 'dl_1rm',    name: 'Deadlift 1RM',         cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Conventional or sumo. Touch-and-go or dead stop, record technique.' },
  { key: 'dl_3rm',    name: 'Deadlift 3RM',         cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Three-rep max. Same setup as 1RM.' },
  { key: 'dl_5rm',    name: 'Deadlift 5RM',         cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Five-rep max. Lower spinal load than 1RM testing.' },
  { key: 'rdl_5rm',   name: 'Romanian DL 5RM',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Hip-hinge variant. Posterior chain emphasis.' },
  { key: 'tb_dl',     name: 'Trap-bar DL 1RM',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Hex/trap bar. Reduced lumbar shear vs conventional.' },
  { key: 'bp_1rm',    name: 'Bench press 1RM',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Touch-and-pause on chest. Feet flat, hips on bench.' },
  { key: 'bp_3rm',    name: 'Bench press 3RM',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Three-rep max. Common in-season test.' },
  { key: 'bp_5rm',    name: 'Bench press 5RM',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Five-rep max. Estimates 1RM at ~87%.' },
  { key: 'inc_bp_1rm',name: 'Incline bench 1RM',    cat: 'Strength',unit: 'kg',     better: 'higher', brief: '30–45° incline. Upper-pec emphasis.' },
  { key: 'ohp_1rm',   name: 'Overhead press 1RM',   cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Strict press. No leg drive.' },
  { key: 'push_press',name: 'Push press 1RM',       cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Leg drive permitted, no re-bend at lockout.' },
  { key: 'pc_1rm',    name: 'Power clean 1RM',      cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Catch above parallel. Fast pull from floor.' },
  { key: 'hp_clean',  name: 'Hang power clean 1RM', cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Hang start at mid-thigh. Hip-explosion focus.' },
  { key: 'snatch_1rm',name: 'Snatch 1RM',           cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Full or power. Highly technical.' },
  // ----- Bodyweight strength -----
  { key: 'pullup_max',name: 'Pull-ups (max reps)',  cat: 'Strength',unit: 'reps',   better: 'higher', brief: 'Strict, dead hang, chin over bar. Bodyweight.' },
  { key: 'pullup_wt', name: 'Weighted pull-up 1RM', cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Added load via belt. Record load excluding bodyweight.' },
  { key: 'chinup_max',name: 'Chin-ups (max reps)',  cat: 'Strength',unit: 'reps',   better: 'higher', brief: 'Supinated grip, strict.' },
  { key: 'dip_max',   name: 'Dips (max reps)',      cat: 'Strength',unit: 'reps',   better: 'higher', brief: 'Bodyweight, full ROM, shoulders below elbows at bottom.' },
  { key: 'dip_wt',    name: 'Weighted dip 1RM',     cat: 'Strength',unit: 'kg',     better: 'higher', brief: 'Belt-loaded. Record added load.' },
  { key: 'pushup_max',name: 'Push-ups in 60s',      cat: 'Strength',unit: 'reps',   better: 'higher', brief: 'Strict, chest to fist depth, 60s window.' },
  // ----- Posterior chain endurance -----
  { key: 'nordic',    name: 'Nordic hamstring max angle', cat: 'Strength', unit: '°',     better: 'higher', brief: 'Break-point angle on NordBord or supervised. Lower angle = stronger eccentric.' },
  { key: 'nordic_force',name: 'Nordic peak force',  cat: 'Strength',unit: 'N',      better: 'higher', brief: 'NordBord peak eccentric hamstring force. Bilateral, asymmetry >15% flagged.' },
  // ----- Isokinetic -----
  { key: 'iso_quad',  name: 'Isokinetic quad 60°/s',cat: 'Strength',unit: 'Nm',     better: 'higher', brief: 'Peak torque concentric knee extension. Asymmetry >10–15% notable.' },
  { key: 'iso_ham',   name: 'Isokinetic ham 60°/s', cat: 'Strength',unit: 'Nm',     better: 'higher', brief: 'Peak torque concentric knee flexion. H:Q ratio ≥0.6 typical target.' },

  // ===== BODY COMP =====
  { key: 'mass',      name: 'Body mass',            cat: 'Body comp',unit: 'kg',    better: 'neutral', brief: 'Morning, post-void.' },
  { key: 'height',    name: 'Standing height',      cat: 'Body comp',unit: 'cm',    better: 'neutral', brief: 'Stadiometer.' },
  { key: 'skinfolds', name: 'Sum of 7 skinfolds',   cat: 'Body comp',unit: 'mm',    better: 'lower',   brief: 'ISAK protocol. Triceps, subscapular, biceps, supraspinale, abdominal, thigh, calf.' },
  { key: 'dexa_lbm',  name: 'DEXA lean mass',       cat: 'Body comp',unit: 'kg',    better: 'higher',  brief: 'Total lean tissue. Gold-standard composition measure.' },
  { key: 'dexa_fm',   name: 'DEXA fat mass',        cat: 'Body comp',unit: 'kg',    better: 'lower',   brief: 'Total fat tissue. Track alongside lean mass changes.' },
  { key: 'bia_pct',   name: 'BIA body fat %',       cat: 'Body comp',unit: '%',     better: 'lower',   brief: 'Bioimpedance estimate. Less accurate than DEXA but quick.' },
  { key: 'waist',     name: 'Waist circumference',  cat: 'Body comp',unit: 'cm',    better: 'lower',   brief: 'Narrowest point between ribs and iliac crest.' },
  // ----- Growth & maturity (for adolescents) -----
  { key: 'sit_height',name: 'Sitting height',       cat: 'Body comp',unit: 'cm',    better: 'neutral', brief: 'Vertex to seat. Tracks trunk growth — combined with standing height gives leg length and feeds maturity offset.' },
  { key: 'mat_offset',name: 'Maturity offset',      cat: 'Body comp',unit: 'yrs',   better: 'neutral', brief: 'Years from peak height velocity (PHV). Mirwald 2002 (updated Moore 2015). Calculate from age, height, sitting height, weight. -1 to +1 yrs = high-risk window for adolescent injury and growth-related load management.' },
  { key: 'phv_age',   name: 'Age at PHV',           cat: 'Body comp',unit: 'yrs',   better: 'neutral', brief: 'Chronological age when peak height velocity was reached. Typically 13.5 (boys) / 11.5 (girls). Once known, helps timing of training stimuli.' },
  { key: 'growth_rate',name: 'Standing height velocity', cat: 'Body comp', unit: 'cm/yr', better: 'neutral', brief: 'Change in standing height between measurements. >8 cm/yr in adolescents suggests entering PHV window — flag for load and injury monitoring.' },

  // ===== CLINICAL (physio / allied health) =====
  // ----- Calf / Achilles -----
  { key: 'slhr_calf', name: 'Single-leg calf raise (max reps)', cat: 'Clinical', unit: 'reps',  better: 'higher', brief: 'Metronome at 60 bpm, knee straight, full height each rep, 10° incline. Hébert-Losier et al. — ~25 reps typical for healthy adults. Bilateral, asymmetry >5 reps notable.' },
  { key: 'slhr_bent', name: 'Bent-knee calf raise (max reps)',  cat: 'Clinical', unit: 'reps',  better: 'higher', brief: 'Soleus-dominant variant. Knee bent to ~60°, 60 bpm metronome.' },
  { key: 'silfverskiold', name: 'Silfverskiöld dorsiflexion (knee straight)', cat: 'Clinical', unit: '°', better: 'higher', brief: 'Ankle DF with knee extended. Compare to knee-flexed measure to isolate gastroc vs soleus tightness.' },
  // ----- Knee / hip ROM -----
  { key: 'thomas',    name: 'Modified Thomas test', cat: 'Clinical',unit: '°',      better: 'higher', brief: 'Hip extension passive ROM. Tests iliopsoas/rectus femoris tightness.' },
  { key: 'ober',      name: 'Modified Ober test',   cat: 'Clinical',unit: '°',      better: 'higher', brief: 'ITB/TFL tightness. Side-lying, hip extended, leg lowered. Record adduction angle.' },
  { key: 'sl_squat',  name: 'Single-leg squat depth', cat: 'Clinical',unit: '°',    better: 'higher', brief: 'Knee flexion at lowest point maintaining control. Asymmetry + knee valgus noted.' },
  { key: 'navicular', name: 'Navicular drop',       cat: 'Clinical',unit: 'mm',     better: 'lower',   brief: 'Foot pronation measure. Difference between sit and stand navicular tuberosity height.' },
  // ----- Hop battery (ACL RTS) -----
  { key: 'sl_hop',    name: 'Single-leg hop for distance', cat: 'Clinical', unit: 'cm', better: 'higher', brief: 'Three trials each side. Limb symmetry index (LSI) ≥90% commonly used; 95–100% recommended for ACL RTS.' },
  { key: 'triple_hop',name: 'Triple hop for distance',     cat: 'Clinical', unit: 'cm', better: 'higher', brief: 'Three consecutive hops, same leg. LSI ≥90% target.' },
  { key: 'triple_x',  name: 'Triple crossover hop',        cat: 'Clinical', unit: 'cm', better: 'higher', brief: 'Three hops, crossing midline. Tests rotational control. LSI ≥90% target.' },
  { key: 'hop_6m',    name: '6m timed hop',                cat: 'Clinical', unit: 's',  better: 'lower',  brief: 'Time to cover 6m on one leg. Requires timing gates for reliability.' },
  { key: 'side_hop',  name: 'Side hop (30s)',              cat: 'Clinical', unit: 'reps', better: 'higher', brief: 'Reps over 30cm tape in 30s. Lateral knee stability + endurance.' },
  // ----- Balance / movement screens -----
  { key: 'yb_ant',    name: 'Y-balance anterior reach',    cat: 'Clinical', unit: '%',  better: 'higher', brief: 'Anterior reach distance as % leg length. <94% LSI = 2.5× injury risk (Plisky). Normal range 60–80% LL.' },
  { key: 'yb_pm',     name: 'Y-balance posteromedial',     cat: 'Clinical', unit: '%',  better: 'higher', brief: 'PM reach % LL. Typically larger than anterior.' },
  { key: 'yb_pl',     name: 'Y-balance posterolateral',    cat: 'Clinical', unit: '%',  better: 'higher', brief: 'PL reach % LL. Composite of three directions used overall.' },
  { key: 'yb_comp',   name: 'Y-balance composite',         cat: 'Clinical', unit: '%',  better: 'higher', brief: 'Average of 3 directions / 3× leg length. Normal range 85–115% LL (age 10–18). 94% LSI composite for D1 athletes.' },
  { key: 'sebt',      name: 'Star excursion balance',      cat: 'Clinical', unit: '%',  better: 'higher', brief: '8-direction reach % LL. Y-balance is a standardised subset (3 directions).' },
  { key: 'fms',       name: 'FMS composite',               cat: 'Clinical', unit: '/21', better: 'higher', brief: '7 movement patterns × 0–3, max 21. ≤14 historically linked to elevated injury risk; modern use is corrective rather than predictive.' },
  // ----- Joint laxity / general screens -----
  { key: 'beighton',  name: 'Beighton hypermobility',      cat: 'Clinical', unit: '/9',  better: 'neutral', brief: '9-point hypermobility scale. ≥4 (women) or ≥6 (men) = generalised joint hypermobility.' },
  { key: 'pain_vas',  name: 'Pain VAS (current)',          cat: 'Clinical', unit: '/10', better: 'lower',   brief: 'Visual analog scale. Worst pain in last 24h, current activity-specific.' },
  // ----- Endurance / aerobic clinical -----
  { key: 'plank',     name: 'Front plank (max hold)',      cat: 'Clinical', unit: 's',   better: 'higher',  brief: 'Forearm plank to failure. Trunk endurance.' },
  { key: 'side_plank',name: 'Side plank (max hold)',       cat: 'Clinical', unit: 's',   better: 'higher',  brief: 'Lateral hip/oblique endurance. Bilateral, asymmetry noted.' },
  { key: 'biering',   name: 'Biering-Sørensen back ext',   cat: 'Clinical', unit: 's',   better: 'higher',  brief: 'Prone trunk extension hold over plinth. <176s (men) / <198s (women) = elevated low back pain risk.' },
  { key: 'mcg_neck',  name: 'McGill neck flexor endurance',cat: 'Clinical', unit: 's',   better: 'higher',  brief: 'Supine head-lift hold. Neck flexor stamina; relevant to whiplash/concussion rehab.' },

  // ===== CUSTOM =====
  { key: 'custom',    name: 'Custom test',          cat: 'Custom',  unit: '',       better: 'neutral', brief: 'Free-form. Define the unit and what counts as a good result inline.' }
];

const TEST_CATEGORIES = ['Aerobic', 'Speed', 'Agility', 'Power', 'Strength', 'Body comp', 'Clinical', 'Custom'];

const getTest = (key) => TEST_CATALOG.find(t => t.key === key) || TEST_CATALOG[TEST_CATALOG.length - 1];

// ============================================================
// OSICS-style body regions (simplified for club use)
// ============================================================
const BODY_REGIONS = [
  'Head/Neck', 'Shoulder', 'Upper arm', 'Elbow', 'Forearm/Wrist/Hand',
  'Chest/Ribs', 'Upper back', 'Lower back', 'Abdomen', 'Hip/Groin',
  'Thigh (anterior)', 'Thigh (posterior)', 'Knee', 'Lower leg',
  'Ankle', 'Foot/Toes'
];

const INJURY_TYPES = [
  'Strain (muscle)', 'Sprain (ligament)', 'Contusion / impact',
  'Overuse / tendinopathy', 'Fracture / bone', 'Joint / cartilage',
  'Concussion', 'Laceration', 'Other'
];

const INJURY_MECHANISMS = [
  'Running / sprinting', 'Change of direction', 'Jumping / landing',
  'Kicking', 'Tackle / contact', 'Collision with object',
  'Overuse (gradual onset)', 'Non-sport / off-field', 'Unknown'
];

// Concussion return-to-play stages (Concussion in Sport Group, 2022)
const RTP_STAGES = [
  { stage: 1, label: 'Symptom-limited activity',  desc: 'Daily activities that do not provoke symptoms.' },
  { stage: 2, label: 'Light aerobic exercise',     desc: 'Walking or stationary cycling, <70% max HR. No resistance training.' },
  { stage: 3, label: 'Sport-specific exercise',    desc: 'Running or skating drills. No head-impact activities.' },
  { stage: 4, label: 'Non-contact training drills',desc: 'Harder training drills (passing). May begin progressive resistance training.' },
  { stage: 5, label: 'Full-contact practice',      desc: 'Following medical clearance. Normal training.' },
  { stage: 6, label: 'Return to sport',            desc: 'Full match-play. Cleared.' }
];


// ============================================================
// GPS / FITNESS DATA UPLOAD
// Canonical metric model + vendor templates
// ============================================================

// The fields we extract from any vendor CSV.
// Every row imported lands in this shape, then gets attached to a workout.
const CANONICAL_FIELDS = [
  { key: 'athleteName',         label: 'Athlete name',           required: 'staff' },  // required for staff upload only
  { key: 'date',                label: 'Session date',           required: 'always' },
  { key: 'sessionType',         label: 'Session type',           required: false },
  { key: 'durationMin',         label: 'Duration (minutes)',     required: false },
  { key: 'distanceM',           label: 'Total distance (m)',     required: false },
  { key: 'highSpeedDistanceM',  label: 'High-speed distance (m)',required: false },
  { key: 'sprintDistanceM',     label: 'Sprint distance (m)',    required: false },
  { key: 'sprintEfforts',       label: 'Sprint efforts',         required: false },
  { key: 'maxVelocityMps',      label: 'Max velocity (m/s)',     required: false },
  { key: 'accelerations',       label: 'Accelerations',          required: false },
  { key: 'decelerations',       label: 'Decelerations',          required: false },
  { key: 'playerLoad',          label: 'Player load',            required: false },
  { key: 'avgHr',               label: 'Average HR (bpm)',       required: false },
  { key: 'maxHr',               label: 'Max HR (bpm)',           required: false },
  { key: 'hrZone1',             label: 'Time in HR zone 1 (s)',  required: false },
  { key: 'hrZone2',             label: 'Time in HR zone 2 (s)',  required: false },
  { key: 'hrZone3',             label: 'Time in HR zone 3 (s)',  required: false },
  { key: 'hrZone4',             label: 'Time in HR zone 4 (s)',  required: false },
  { key: 'hrZone5',             label: 'Time in HR zone 5 (s)',  required: false },
  { key: 'elevationGainM',      label: 'Elevation gain (m)',     required: false },
  { key: 'rpe',                 label: 'RPE (0-10)',             required: false }
];

const CANONICAL_KEYS = CANONICAL_FIELDS.map(f => f.key);

// Vendor templates. The `headers` are normalised (lowercased, trimmed) for
// signature matching. `mapping` maps the vendor's column header → canonical key.
const VENDOR_TEMPLATES = [
  {
    vendor: 'catapult',
    label: 'Catapult OpenField',
    description: 'OpenField CSV export. Includes Player Load, GPS, accels/decels.',
    sampleHeaders: ['Player Name', 'Date', 'Session Title', 'Total Player Load', 'Total Distance (m)', 'HSR Distance (m)', 'Sprint Distance (m)', 'Sprints', 'Max Velocity (km/h)', 'Accelerations', 'Decelerations'],
    mapping: {
      'player name':              'athleteName',
      'date':                     'date',
      'session title':            'sessionType',
      'total player load':        'playerLoad',
      'total distance (m)':       'distanceM',
      'hsr distance (m)':         'highSpeedDistanceM',
      'sprint distance (m)':      'sprintDistanceM',
      'sprints':                  'sprintEfforts',
      'max velocity (km/h)':      'maxVelocityKmh',  // converted to m/s
      'accelerations':            'accelerations',
      'decelerations':            'decelerations',
      'duration (min)':           'durationMin',
      'average heart rate':       'avgHr',
      'maximum heart rate':       'maxHr'
    }
  },
  {
    vendor: 'statsports',
    label: 'StatSports APEX',
    description: 'APEX dashboard CSV export.',
    sampleHeaders: ['Player', 'Date', 'Session', 'Total Distance', 'High Speed Running', 'Sprint Distance', 'Number of Sprints', 'Max Speed (m/s)', 'Acc Count', 'Dec Count', 'Dynamic Stress Load'],
    mapping: {
      'player':                'athleteName',
      'date':                  'date',
      'session':               'sessionType',
      'total distance':        'distanceM',
      'high speed running':    'highSpeedDistanceM',
      'sprint distance':       'sprintDistanceM',
      'number of sprints':     'sprintEfforts',
      'max speed (m/s)':       'maxVelocityMps',
      'acc count':             'accelerations',
      'dec count':             'decelerations',
      'dynamic stress load':   'playerLoad',
      'duration':              'durationMin'
    }
  },
  {
    vendor: 'polar',
    label: 'Polar Team Pro',
    description: 'Polar Team Pro CSV export. Strong HR data.',
    sampleHeaders: ['First name', 'Last name', 'Date', 'Duration', 'Total distance', 'Sprints', 'Max speed', 'Average heart rate', 'Maximum heart rate', 'Time in zone 1', 'Time in zone 2', 'Time in zone 3', 'Time in zone 4', 'Time in zone 5'],
    mapping: {
      'full name':              'athleteName',         // synthesised from first+last
      'date':                   'date',
      'duration':               'durationMin',
      'total distance':         'distanceM',
      'sprints':                'sprintEfforts',
      'max speed':              'maxVelocityKmh',
      'average heart rate':     'avgHr',
      'maximum heart rate':     'maxHr',
      'time in zone 1':         'hrZone1',
      'time in zone 2':         'hrZone2',
      'time in zone 3':         'hrZone3',
      'time in zone 4':         'hrZone4',
      'time in zone 5':         'hrZone5'
    }
  },
  {
    vendor: 'garmin',
    label: 'Garmin Connect',
    description: 'Garmin Connect activity export. Best for individual athletes.',
    sampleHeaders: ['Activity Type', 'Date', 'Title', 'Distance', 'Time', 'Avg HR', 'Max HR', 'Avg Pace', 'Elev Gain', 'Calories'],
    mapping: {
      'activity type':  'sessionType',
      'date':           'date',
      'distance':       'distanceKm',         // converted to m
      'time':           'durationMin',        // hh:mm:ss string parsed
      'avg hr':         'avgHr',
      'max hr':         'maxHr',
      'avg pace':       'avgPaceSecPerKm',
      'elev gain':      'elevationGainM'
    }
  },
  {
    vendor: 'strava',
    label: 'Strava bulk export',
    description: 'Strava activities.csv from bulk export.',
    sampleHeaders: ['Activity Date', 'Activity Type', 'Elapsed Time', 'Distance', 'Average Heart Rate', 'Max Heart Rate', 'Elevation Gain', 'Max Speed'],
    mapping: {
      'activity date':       'date',
      'activity type':       'sessionType',
      'elapsed time':        'durationSec',
      'distance':            'distanceKm',
      'average heart rate':  'avgHr',
      'max heart rate':      'maxHr',
      'elevation gain':      'elevationGainM',
      'max speed':           'maxVelocityKmh'
    }
  },
  {
    vendor: 'generic',
    label: 'Generic GPS / fitness CSV',
    description: 'Other source. You\'ll map columns manually.',
    sampleHeaders: [],
    mapping: {}
  }
];

// Try to detect a vendor by overlap between CSV headers and known signatures
const detectVendor = (csvHeaders) => {
  const lower = csvHeaders.map(h => h.toLowerCase().trim());
  let best = { vendor: 'generic', score: 0 };
  VENDOR_TEMPLATES.forEach(t => {
    if (t.vendor === 'generic') return;
    const keys = Object.keys(t.mapping);
    if (keys.length === 0) return;
    const matches = keys.filter(k => lower.includes(k)).length;
    const score = matches / keys.length;
    if (score > best.score) best = { vendor: t.vendor, score };
  });
  // Require >50% header overlap to claim a vendor; below that, force generic
  return best.score >= 0.5 ? best.vendor : 'generic';
};

// Parse a CSV string (very small parser — handles quoted fields and commas)
const parseCsv = (text) => {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      } else { field += c; }
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); if (row.some(v => v !== '')) rows.push(row); }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0];
  const dataRows = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] !== undefined ? r[i].trim() : ''; });
    return obj;
  });
  return { headers, rows: dataRows };
};

// Convert any reasonable date input to YYYY-MM-DD
const parseDateLoose = (val) => {
  if (!val) return null;
  // ISO YYYY-MM-DD passes through
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  // Try Date parsing
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

// Convert hh:mm:ss or mm:ss or "30 min" to minutes
const parseDurationToMin = (val) => {
  if (!val) return null;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s); // already minutes
  // hh:mm:ss
  const m1 = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (m1) return Number(m1[1]) * 60 + Number(m1[2]) + Number(m1[3]) / 60;
  // mm:ss
  const m2 = s.match(/^(\d+):(\d{2})$/);
  if (m2) return Number(m2[1]) + Number(m2[2]) / 60;
  // "30 min" / "30m"
  const m3 = s.match(/^(\d+(?:\.\d+)?)\s*(min|m)$/i);
  if (m3) return Number(m3[1]);
  return null;
};

// Take a raw vendor row + a column→canonical mapping → canonical row.
// Handles unit conversions (km→m, km/h→m/s) for "intermediate" canonical keys.
const applyMapping = (vendorRow, mapping) => {
  const out = {};
  Object.entries(mapping).forEach(([vendorCol, canonicalKey]) => {
    // Find the actual column name (case-insensitive) on the row
    const matchingKey = Object.keys(vendorRow).find(k => k.toLowerCase().trim() === vendorCol);
    if (!matchingKey) return;
    const raw = vendorRow[matchingKey];
    if (raw === '' || raw === undefined || raw === null) return;

    // Unit conversions and special parses
    if (canonicalKey === 'maxVelocityKmh') {
      const n = Number(raw); if (!isNaN(n)) out.maxVelocityMps = +(n / 3.6).toFixed(2);
    } else if (canonicalKey === 'distanceKm') {
      const n = Number(raw); if (!isNaN(n)) out.distanceM = Math.round(n * 1000);
    } else if (canonicalKey === 'durationSec') {
      const n = Number(raw); if (!isNaN(n)) out.durationMin = +(n / 60).toFixed(1);
    } else if (canonicalKey === 'durationMin') {
      const v = parseDurationToMin(raw); if (v !== null) out.durationMin = +v.toFixed(1);
    } else if (canonicalKey === 'date') {
      const v = parseDateLoose(raw); if (v) out.date = v;
    } else if (canonicalKey === 'avgPaceSecPerKm') {
      // Garmin pace looks like "4:32" (min/km) — convert to seconds
      const m = String(raw).match(/^(\d+):(\d{2})$/);
      if (m) out.avgPaceSecPerKm = Number(m[1]) * 60 + Number(m[2]);
    } else {
      // Numeric or pass-through
      if (typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
        out[canonicalKey] = Number(raw);
      } else {
        out[canonicalKey] = raw;
      }
    }
  });
  return out;
};

// Polar exports use First name + Last name — synthesise full name
const polarPrepareRow = (row) => {
  const first = row['First name'] || row['first name'] || '';
  const last  = row['Last name']  || row['last name']  || '';
  if (first || last) {
    return { ...row, 'Full Name': `${first} ${last}`.trim() };
  }
  return row;
};

// Resolve athlete name to id (fuzzy: case-insensitive, last-name match if needed)
const resolveAthleteName = (name, athletes) => {
  if (!name) return null;
  const norm = name.toLowerCase().trim();
  // Exact match
  let m = athletes.find(a => a.name.toLowerCase() === norm);
  if (m) return m.id;
  // "Last, First" → "First Last"
  if (norm.includes(',')) {
    const [last, first] = norm.split(',').map(s => s.trim());
    m = athletes.find(a => a.name.toLowerCase() === `${first} ${last}`);
    if (m) return m.id;
  }
  // Last-name only match (unique)
  const lastName = norm.split(' ').pop();
  const lastMatches = athletes.filter(a => a.name.toLowerCase().split(' ').pop() === lastName);
  if (lastMatches.length === 1) return lastMatches[0].id;
  return null;
};


// No storage dependency. Called once at app start.
const generateSeedData = () => {
  const athleteNames = [
    'Tom Mercer', 'Liam Hartley', 'Jack Donovan', 'Noah Whitfield',
    'Ethan Cole', 'Mia Pereira', 'Ava Lindqvist', 'Sophie Bremner'
  ];

  // Squad designation — splits the senior squad into two age groups so a
  // multi-squad club is the seed default. Coaches commonly want to filter
  // by squad without losing the whole-club view.
  const athleteSquads = [
    'Seniors',  // Tom
    'Seniors',  // Liam
    'Seniors',  // Jack
    'Seniors',  // Noah
    'Seniors',  // Ethan
    'U18s',     // Mia
    'U18s',     // Ava
    'U18s'      // Sophie
  ];

  // Injury / availability status — the traffic light:
  //   'available'  → green   training fully
  //   'modified'   → amber   transitioning / return-to-play
  //   'unavailable'→ red     out, not fit
  // Tied to characters: Noah has the hamstring → amber, Liam high load but fit → green
  const injuryStatus = [
    'available',    // Tom
    'available',    // Liam (load climbing but available)
    'available',    // Jack
    'modified',     // Noah — left hamstring tightness, RTP
    'available',    // Ethan
    'available',    // Mia
    'unavailable',  // Ava — shoulder, out
    'available'     // Sophie
  ];

  const injuryNotes = [
    null,
    null,
    null,
    'L hamstring · modified running',
    null,
    null,
    'R shoulder · out 2–3 wks',
    null
  ];

  // Per-athlete profile detail (identity, contact, sport-specific, medical)
  const profileExtras = [
    { dob: '1998-03-12', height: 184, weight: 82, dominantSide: 'Right',
      contactPhone: '+61 412 555 011', contactEmail: 'tom.mercer@example.com',
      address: '14 Murray St, Marlborough',
      emergencyName: 'Karen Mercer', emergencyRelation: 'Partner', emergencyPhone: '+61 412 555 092',
      gpName: 'Dr. Sarah Liu', gpClinic: 'Marlborough Family Medical', gpPhone: '03 5570 1212',
      bloodType: 'O+', allergies: 'Penicillin', medications: 'Nil regular',
      medicalConditions: 'Mild asthma — Ventolin PRN', insurer: 'Medibank · #1234567',
      preferredSurface: 'Synthetic', kickingFoot: 'Right',
      yearsExperience: 9, notes: 'Captain 2025. Comfortable in deep forward or pinch-hit ruck.' },

    { dob: '2001-07-22', height: 178, weight: 76, dominantSide: 'Left',
      contactPhone: '+61 412 555 012', contactEmail: 'liam.hartley@example.com',
      address: '32 Beach Rd, Marlborough',
      emergencyName: 'Pam Hartley', emergencyRelation: 'Mother', emergencyPhone: '+61 412 555 093',
      gpName: 'Dr. Sarah Liu', gpClinic: 'Marlborough Family Medical', gpPhone: '03 5570 1212',
      bloodType: 'A+', allergies: 'None known', medications: 'Nil',
      medicalConditions: 'None', insurer: 'Bupa · #9876543',
      preferredSurface: 'Grass', kickingFoot: 'Left',
      yearsExperience: 5, notes: 'High runner. Trades into midfield from wing.' },

    { dob: '1995-11-04', height: 191, weight: 91, dominantSide: 'Right',
      contactPhone: '+61 412 555 013', contactEmail: 'jack.donovan@example.com',
      address: '8 Hill Crescent, Marlborough',
      emergencyName: 'Megan Donovan', emergencyRelation: 'Wife', emergencyPhone: '+61 412 555 094',
      gpName: 'Dr. Phil Mendez', gpClinic: 'Coast Medical Centre', gpPhone: '03 5570 2244',
      bloodType: 'B+', allergies: 'Shellfish', medications: 'Nil',
      medicalConditions: 'Prior R ankle sprain (2021, 2023, 2025)', insurer: 'HCF · #5544332',
      preferredSurface: 'Grass', kickingFoot: 'Right',
      yearsExperience: 12, notes: 'Veteran defender. Strong overhead. Watch ankle prevention.' },

    { dob: '1999-05-30', height: 182, weight: 79, dominantSide: 'Right',
      contactPhone: '+61 412 555 014', contactEmail: 'noah.whitfield@example.com',
      address: '21 Tower Lane, Marlborough',
      emergencyName: 'Eddie Whitfield', emergencyRelation: 'Brother', emergencyPhone: '+61 412 555 095',
      gpName: 'Dr. Sarah Liu', gpClinic: 'Marlborough Family Medical', gpPhone: '03 5570 1212',
      bloodType: 'O-', allergies: 'None known', medications: 'Iron supplement',
      medicalConditions: 'Prior L hamstring (Apr 2024) — current re-strain', insurer: 'AHM · #1122334',
      preferredSurface: 'Grass', kickingFoot: 'Right',
      yearsExperience: 7, notes: 'Watch hamstring. NHE protocol mandatory.' },

    { dob: '2000-02-18', height: 180, weight: 77, dominantSide: 'Right',
      contactPhone: '+61 412 555 015', contactEmail: 'ethan.cole@example.com',
      address: '5 Park Ave, Marlborough',
      emergencyName: 'Sue Cole', emergencyRelation: 'Mother', emergencyPhone: '+61 412 555 096',
      gpName: 'Dr. Sarah Liu', gpClinic: 'Marlborough Family Medical', gpPhone: '03 5570 1212',
      bloodType: 'A+', allergies: 'None known', medications: 'Nil',
      medicalConditions: 'None', insurer: 'Medibank · #2233445',
      preferredSurface: 'Grass', kickingFoot: 'Right',
      yearsExperience: 6, notes: 'Box-to-box engine.' },

    { dob: '2002-09-08', height: 173, weight: 68, dominantSide: 'Left',
      contactPhone: '+61 412 555 016', contactEmail: 'mia.pereira@example.com',
      address: '17 Ridge Pl, Marlborough',
      emergencyName: 'Tony Pereira', emergencyRelation: 'Father', emergencyPhone: '+61 412 555 097',
      gpName: 'Dr. Phil Mendez', gpClinic: 'Coast Medical Centre', gpPhone: '03 5570 2244',
      bloodType: 'O+', allergies: 'Latex', medications: 'Combined OCP',
      medicalConditions: 'None', insurer: 'NIB · #3344556',
      preferredSurface: 'Synthetic', kickingFoot: 'Left',
      yearsExperience: 4, notes: 'Tracks fastest opponent. Strong 1v1.' },

    { dob: '1997-12-15', height: 188, weight: 84, dominantSide: 'Right',
      contactPhone: '+61 412 555 017', contactEmail: 'ava.lindqvist@example.com',
      address: '3 Coast Dr, Marlborough',
      emergencyName: 'Marcus Lindqvist', emergencyRelation: 'Partner', emergencyPhone: '+61 412 555 098',
      gpName: 'Dr. Sarah Liu', gpClinic: 'Marlborough Family Medical', gpPhone: '03 5570 1212',
      bloodType: 'AB+', allergies: 'None known', medications: 'Nil',
      medicalConditions: 'Current R AC joint sprain (gr 2)', insurer: 'Bupa · #4455667',
      preferredSurface: 'Grass', kickingFoot: 'Right',
      yearsExperience: 10, notes: 'Keeper. Imaging scheduled for shoulder.' },

    { dob: '2003-04-25', height: 169, weight: 64, dominantSide: 'Right',
      contactPhone: '+61 412 555 018', contactEmail: 'sophie.bremner@example.com',
      address: '11 Forest St, Marlborough',
      emergencyName: 'Jane Bremner', emergencyRelation: 'Mother', emergencyPhone: '+61 412 555 099',
      gpName: 'Dr. Phil Mendez', gpClinic: 'Coast Medical Centre', gpPhone: '03 5570 2244',
      bloodType: 'A-', allergies: 'None known', medications: 'Nil',
      medicalConditions: 'Prior concussion (Apr 2026) — cleared', insurer: 'Medibank · #5566778',
      preferredSurface: 'Synthetic', kickingFoot: 'Right',
      yearsExperience: 3, notes: 'Annual SCAT6 mandatory due to concussion history.' }
  ];

  // Per-athlete contact sharing preferences — controls what is visible on the
  // staff Contacts tab. Most athletes share phone+email by default; sensitive
  // fields (emergency contact, GP) require explicit opt-in.
  const contactSharingDefaults = [
    { phone: true,  email: true, emergencyContact: true,  gp: true,  notes: '' },           // Tom — opted into all
    { phone: true,  email: true, emergencyContact: false, gp: false, notes: '' },           // Liam
    { phone: true,  email: true, emergencyContact: true,  gp: false, notes: '' },           // Jack
    { phone: false, email: true, emergencyContact: true,  gp: true,  notes: 'Prefer email contact.' }, // Noah — injured, GP context shared
    { phone: true,  email: true, emergencyContact: false, gp: false, notes: '' },           // Ethan
    { phone: true,  email: true, emergencyContact: true,  gp: false, notes: '' },           // Mia
    { phone: true,  email: true, emergencyContact: true,  gp: true,  notes: '' },           // Ava — injured
    { phone: false, email: true, emergencyContact: true,  gp: false, notes: 'Text only — no calls before 8am.' } // Sophie
  ];

  const teamAthletes = athleteNames.map((name, i) => ({
    id: `ath_${i + 1}`,
    name,
    playerId: `MFC-${(i + 12).toString().padStart(3, '0')}`,
    team: 'Marlborough FC',
    squad: athleteSquads[i],
    position: ['Forward', 'Midfield', 'Defender', 'Forward', 'Midfield', 'Defender', 'Goalkeeper', 'Midfield'][i],
    injuryStatus: injuryStatus[i],
    injuryNote: injuryNotes[i],
    profile: profileExtras[i],
    contactSharing: contactSharingDefaults[i],
    // Wellness preferences — most on daily, one on three-per-week, one off entirely
    // to demonstrate how the practitioner side handles each case.
    wellnessSettings: i === 2 ? { frequency: 'off',           enabledFields: { fatigue: true, soreness: true, sleep: true, stress: true, mood: true, motivation: true } }
                    : i === 5 ? { frequency: 'three_per_week',enabledFields: { fatigue: true, soreness: true, sleep: true, stress: false, mood: false, motivation: false } }
                    :           { frequency: 'daily',         enabledFields: { fatigue: true, soreness: true, sleep: true, stress: true, mood: true, motivation: true } }
  }));

  // Independent / cross-club athletes — these don't belong to Marlborough FC.
  // They demonstrate the mass-market case: athletes who hire staff individually.
  teamAthletes.push(
    {
      id: 'ath_adam',
      name: 'Adam Reeves',
      playerId: null,
      team: null,  // independent
      position: 'Marathon runner',
      injuryStatus: 'available',
      injuryNote: null,
      profile: {
        dateOfBirth: '1989-06-12',
        sex: 'M', height: 178, weight: 74,
        primarySport: 'Distance running',
        contactPhone: '+61 412 555 202',
        contactEmail: 'sc@marlborough.fc',
        emergencyName: 'Kate Reeves',
        emergencyRelation: 'Partner',
        emergencyPhone: '+61 412 333 891',
        gpName: 'Dr. Lewis Tran',
        gpClinic: 'Northcote Family Practice',
        gpPhone: '+61 3 9489 4422'
      },
      contactSharing: { phone: true, email: true, emergencyContact: false, gp: false, notes: '' },
      ownerUserId: 'usr_sc'  // this athlete profile is owned by Adam's user account
    },
    {
      id: 'ath_priya',
      name: 'Priya Naidu',
      playerId: null,
      team: null,
      position: 'Trail runner',
      injuryStatus: 'available',
      injuryNote: null,
      profile: {
        dateOfBirth: '1995-03-22',
        sex: 'F', height: 165, weight: 56,
        primarySport: 'Trail / ultra running',
        contactPhone: '+61 423 778 105',
        contactEmail: 'priya.naidu@example.com',
        emergencyName: 'Vikram Naidu',
        emergencyRelation: 'Brother',
        emergencyPhone: '+61 412 998 776',
        gpName: 'Dr. Mei Tan',
        gpClinic: 'Coastal Health Group',
        gpPhone: '+61 3 9521 0099'
      },
      contactSharing: { phone: true, email: true, emergencyContact: true, gp: true, notes: 'Training for Buffalo Stampede ultra in November.' },
      ownerUserId: 'usr_priya'
    },
    {
      id: 'ath_felix',
      name: 'Felix Yamamoto',
      playerId: null,
      team: null,
      position: 'Hybrid athlete',
      injuryStatus: 'modified',
      injuryNote: 'L shoulder impingement — rehab phase',
      profile: {
        dateOfBirth: '1992-11-04',
        sex: 'M', height: 182, weight: 86,
        primarySport: 'Hybrid (strength + endurance)',
        contactPhone: '+61 401 220 533',
        contactEmail: 'felix.y@example.com',
        emergencyName: 'Hana Yamamoto',
        emergencyRelation: 'Spouse',
        emergencyPhone: '+61 412 660 117',
        gpName: 'Dr. Nadia Hassan',
        gpClinic: 'Brunswick Sports Medicine',
        gpPhone: '+61 3 9387 2210'
      },
      contactSharing: { phone: true, email: true, emergencyContact: true, gp: true, notes: '' },
      ownerUserId: 'usr_felix'
    }
  );

  const teamWorkouts = [];
  const teamWellness = [];
  const baseDate = new Date();

  // Use a deterministic-ish but varied generator so reloads look consistent enough
  let s = 1;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  // Session-type vocabulary per sport context — keeps the data plausible
  // for the independent athletes who aren't doing team football.
  const sessionTypeFor = (athlete, dow) => {
    const sport = athlete.profile?.primarySport || '';
    if (sport.includes('running')) {
      // Distance / trail runners: long run on Sat, tempo Tue/Thu, easy other days
      if (dow === 6) return 'Long run';
      if (dow === 2 || dow === 4) return 'Tempo run';
      if (dow === 1 || dow === 5) return 'Easy run';
      return 'Easy run';
    }
    if (sport.toLowerCase().includes('hybrid')) {
      // Hybrid: alternating strength + conditioning
      if (dow === 1 || dow === 4) return 'Strength';
      if (dow === 2 || dow === 5) return 'Conditioning';
      if (dow === 6) return 'Long ride';
      return 'Active recovery';
    }
    // Default football vocabulary
    if (dow === 2 || dow === 4) return 'Team Training';
    if (dow === 6) return 'Match';
    return 'Strength';
  };

  teamAthletes.forEach((ath, idx) => {
    const baseRPE = 5 + (idx % 3);
    const baseDur = 60 + (idx % 4) * 15;
    const spike = idx === 1 || idx === 4;
    const lowVar = idx === 6;
    const poorWellness = idx === 3 || idx === 1;
    const unavailableSince = ath.injuryStatus === 'unavailable' ? 6 : null; // no sessions in last N days
    const modifiedReducedLoad = ath.injuryStatus === 'modified';
    const isRunner = ath.profile?.primarySport?.includes('running');

    for (let i = 27; i >= 0; i--) {
      const d = new Date(baseDate);
      d.setDate(baseDate.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const dow = d.getDay();

      // Skip recent days for unavailable athletes
      if (unavailableSince !== null && i < unavailableSince) continue;

      if (dow !== 0 && rand() > 0.15) {
        let rpe = baseRPE + Math.floor(rand() * 3) - 1;
        let dur = baseDur + Math.floor(rand() * 30) - 15;
        if (lowVar) { rpe = baseRPE; dur = baseDur; }
        if (spike && i < 7) { rpe += 2; dur += 20; }
        if (modifiedReducedLoad) { rpe = Math.max(2, rpe - 2); dur = Math.max(20, dur - 20); }
        rpe = Math.max(1, Math.min(10, rpe));
        dur = Math.max(20, dur);

        teamWorkouts.push({
          id: `w_${ath.id}_${ds}`,
          athleteId: ath.id,
          date: ds,
          type: sessionTypeFor(ath, dow),
          duration: dur,
          rpe,
          source: 'manual',
          note: '',
          // GPS / HR data — populated for running-based sessions
          // (skip 'Strength' sessions, no GPS for gym work)
          ...(dow !== 1 && dow !== 5 ? {
            distanceM:           isRunner
              ? Math.round((dow === 6 ? 24000 : 8000) + rand() * (dow === 6 ? 8000 : 4000))
              : Math.round(4500 + rand() * 4500 + (dow === 6 ? 2000 : 0)),
            highSpeedDistanceM:  Math.round(280 + rand() * 380),
            sprintDistanceM:     Math.round(90 + rand() * 160),
            sprintEfforts:       Math.round(8 + rand() * 18),
            maxVelocityMps:      +(7.8 + rand() * 1.6).toFixed(2),
            accelerations:       Math.round(30 + rand() * 25),
            decelerations:       Math.round(28 + rand() * 24),
            playerLoad:          +(280 + rand() * 220 + (dow === 6 ? 80 : 0)).toFixed(1),
            avgHr:               Math.round(132 + rand() * 18),
            maxHr:               Math.round(178 + rand() * 12),
            hrZones: {
              z1: Math.round(dur * 60 * 0.18),
              z2: Math.round(dur * 60 * 0.27),
              z3: Math.round(dur * 60 * 0.28),
              z4: Math.round(dur * 60 * 0.18),
              z5: Math.round(dur * 60 * 0.09)
            },
            uploadSource: ['catapult', 'statsports', 'polar'][i % 3]
          } : {})
        });
      }

      if (rand() > 0.2) {
        const base = poorWellness ? 4 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 3);
        teamWellness.push({
          id: `wc_${ath.id}_${ds}`,
          athleteId: ath.id,
          date: ds,
          fatigue: Math.min(7, base + Math.floor(rand() * 2)),
          soreness: Math.min(7, base + Math.floor(rand() * 2) - (rand() > 0.5 ? 1 : 0)),
          sleep: Math.min(7, base + Math.floor(rand() * 2) - 1),
          stress: Math.min(7, Math.max(0, base + Math.floor(rand() * 3) - 1)),
          mood: Math.min(7, Math.max(0, base + Math.floor(rand() * 2) - 1)),
          motivation: Math.min(7, Math.max(0, base + Math.floor(rand() * 2) - 1))
        });
      }
    }
  });

  const teamNotes = [
    { id: 'n1', athleteId: 'ath_2', author: 'A. Reeves', role: 'S&C Coach', date: today(),
      type: 'Coach', visibility: 'staff',
      text: 'Load has climbed sharply this week — flag for review before Saturday selection.' },
    { id: 'n2', athleteId: 'ath_4', author: 'Dr. Patel', role: 'Physio', date: today(),
      type: 'Clinician', visibility: 'medical',
      text: 'Reports tight left hamstring post-Wed session. Modified running on Thursday. Monitor.' },
    // Athlete-visible coordination notes — short, actionable, time-bound
    { id: 'n3', athleteId: 'ath_1', author: 'Dr. Patel', role: 'Physio', date: today(),
      type: 'Coordination', visibility: 'athlete',
      text: 'Skip the conditioning block tonight — just gym session. Quick chat tomorrow morning.',
      acknowledged: false },
    { id: 'n4', athleteId: 'ath_2', author: 'A. Reeves', role: 'S&C Coach', date: today(),
      type: 'Coordination', visibility: 'athlete',
      text: 'Lighter gym week — keep loads at 70% of last week. Focus on movement quality.',
      acknowledged: false },
    { id: 'n5', athleteId: 'ath_4', author: 'M. Connolly', role: 'Head Coach', date: today(),
      type: 'Coordination', visibility: 'athlete',
      text: 'Modified training only this week. Talk to Dr. Patel before Saturday selection.',
      acknowledged: false }
  ];

  // ===== Injury records (full) =====
  const offsetDate = (days) => {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const teamInjuries = [
    {
      id: 'inj_1',
      athleteId: 'ath_4',
      status: 'modified',
      bodyRegion: 'Thigh (posterior)',
      side: 'Left',
      injuryType: 'Strain (muscle)',
      mechanism: 'Running / sprinting',
      contactMechanism: 'Non-contact',
      activity: 'Match',
      activityContext: 'Round 6 vs Eastlake — sprinted for through-ball in 38th min, felt grab',
      severity: 2,
      recurrence: 'Recurrence (same site)',
      priorInjuryRef: 'L hamstring strain Apr 2024',
      occurredOn: offsetDate(-9),
      reportedOn: offsetDate(-9),
      reportedBy: 'Dr. Patel',
      diagnosis: 'Grade 1 biceps femoris strain',
      icd10: 'S76.30',
      osicsCode: 'TPH1',
      imaging: 'MRI L thigh',
      imagingDate: offsetDate(-8),
      imagingFindings: 'Low-grade intramuscular oedema at long head of biceps femoris musculotendinous junction. No tendon avulsion.',
      treatment: 'PEACE & LOVE protocol. Manual therapy 2x/wk. Progressive eccentric loading from day 7 (Askling L-protocol).',
      expectedRTP: offsetDate(7),
      actualRTP: null,
      rtpProgress: [
        { stage: 'Walking pain-free', achieved: true, date: offsetDate(-7) },
        { stage: 'Light jog 50% pace', achieved: true, date: offsetDate(-4) },
        { stage: 'Running 70% pace', achieved: true, date: offsetDate(-1) },
        { stage: 'Strides + change of direction', achieved: false, date: null },
        { stage: 'Full training', achieved: false, date: null },
        { stage: 'Match available', achieved: false, date: null }
      ],
      painScale: 2,
      romLimitation: '15° knee flexion deficit prone position',
      followUp: offsetDate(2),
      prevention: 'Nordic hamstring program (3x/wk), warm-up adjustments',
      notes: 'Modified running only. Reassess Thursday.'
    },
    {
      id: 'inj_2',
      athleteId: 'ath_7',
      status: 'unavailable',
      bodyRegion: 'Shoulder',
      side: 'Right',
      injuryType: 'Sprain (ligament)',
      mechanism: 'Collision with object',
      contactMechanism: 'Contact',
      activity: 'Match',
      activityContext: 'Round 7 vs Northlake — collided with post diving for save',
      severity: 3,
      recurrence: 'New (first occurrence)',
      priorInjuryRef: null,
      occurredOn: offsetDate(-6),
      reportedOn: offsetDate(-6),
      reportedBy: 'Dr. Patel',
      diagnosis: 'Grade 2 AC joint sprain — Rockwood II',
      icd10: 'S43.5',
      osicsCode: 'SAS2',
      imaging: 'X-ray, US',
      imagingDate: offsetDate(-6),
      imagingFindings: 'AC joint widening 6mm. CC ligament intact. No fracture.',
      treatment: 'Sling 5 days. ROM exercises from day 3. Imaging follow-up scheduled.',
      expectedRTP: offsetDate(14),
      actualRTP: null,
      rtpProgress: [
        { stage: 'Pain-free at rest', achieved: true, date: offsetDate(-3) },
        { stage: 'Full passive ROM', achieved: false, date: null },
        { stage: 'Full active ROM', achieved: false, date: null },
        { stage: 'Loaded ROM (gym)', achieved: false, date: null },
        { stage: 'Sport-specific (diving, throwing)', achieved: false, date: null },
        { stage: 'Match available', achieved: false, date: null }
      ],
      painScale: 4,
      romLimitation: 'Active abduction 90° (limited by pain)',
      followUp: offsetDate(1),
      prevention: 'Posterior cuff strengthening, scap stability',
      notes: 'Goalkeeping role — RTP gated on full overhead ROM.'
    },
    {
      id: 'inj_3',
      athleteId: 'ath_3',
      status: 'returned',
      bodyRegion: 'Ankle',
      side: 'Right',
      injuryType: 'Sprain (ligament)',
      mechanism: 'Change of direction',
      contactMechanism: 'Non-contact',
      activity: 'Training',
      activityContext: 'Tuesday session — small-sided game, planted to change direction',
      severity: 2,
      recurrence: 'Recurrence (same site)',
      priorInjuryRef: 'R ankle sprain Sep 2023, May 2021',
      occurredOn: offsetDate(-45),
      reportedOn: offsetDate(-45),
      reportedBy: 'Dr. Patel',
      diagnosis: 'Lateral ankle sprain — ATFL grade 2',
      icd10: 'S93.4',
      osicsCode: 'AKS2',
      imaging: 'None',
      imagingDate: null,
      imagingFindings: null,
      treatment: 'POLICE. Progressive balance and proprioception. Wobble board → single-leg → sport-specific.',
      expectedRTP: offsetDate(-25),
      actualRTP: offsetDate(-24),
      rtpProgress: [
        { stage: 'Pain-free walking', achieved: true, date: offsetDate(-42) },
        { stage: 'Light jog', achieved: true, date: offsetDate(-38) },
        { stage: 'Sprint + COD', achieved: true, date: offsetDate(-32) },
        { stage: 'Full training', achieved: true, date: offsetDate(-28) },
        { stage: 'Match available', achieved: true, date: offsetDate(-24) }
      ],
      painScale: 0,
      romLimitation: 'Resolved',
      followUp: null,
      prevention: 'Bracing during return-to-sport. Single-leg balance maintenance program.',
      notes: 'Closed. No recurrence. Maintenance balance work continues.'
    }
  ];

  // ===== Test results =====
  // Helper for varied but realistic values
  const seedTestResult = (id, athleteId, testKey, daysAgo, value, extra = {}) => ({
    id,
    athleteId,
    testKey,
    date: offsetDate(-daysAgo),
    value,
    ...extra,
    enteredBy: extra.enteredBy || 'A. Reeves',
    notes: extra.notes || ''
  });

  const teamTests = [
    // Pre-season battery (all athletes, ~60 days ago)
    seedTestResult('t1', 'ath_1', 'cmj',       60, 38.2),
    seedTestResult('t2', 'ath_1', 'sprint_20', 60, 3.05),
    seedTestResult('t3', 'ath_1', 'yyir1',     60, 1840),
    seedTestResult('t4', 'ath_1', '1rm_squat', 60, 120),
    seedTestResult('t5', 'ath_1', 'nordic',    60, 305),

    seedTestResult('t10','ath_2', 'cmj',       60, 42.5),
    seedTestResult('t11','ath_2', 'sprint_20', 60, 2.94),
    seedTestResult('t12','ath_2', 'yyir1',     60, 2280),
    seedTestResult('t13','ath_2', '1rm_squat', 60, 135),
    seedTestResult('t14','ath_2', 'nordic',    60, 340),
    seedTestResult('t15','ath_2', 'tt_2k',     60, '6:42'),

    seedTestResult('t20','ath_3', 'cmj',       60, 36.8),
    seedTestResult('t21','ath_3', 'sprint_20', 60, 3.12),
    seedTestResult('t22','ath_3', 'yyir1',     60, 1640),
    seedTestResult('t23','ath_3', '1rm_squat', 60, 115),

    seedTestResult('t30','ath_4', 'cmj',       60, 40.1),
    seedTestResult('t31','ath_4', 'sprint_20', 60, 2.98),
    seedTestResult('t32','ath_4', 'yyir1',     60, 2120),
    seedTestResult('t33','ath_4', 'nordic',    60, 248, { notes: 'Below 256N threshold — flag for prevention work.' }),

    seedTestResult('t40','ath_5', 'cmj',       60, 39.4),
    seedTestResult('t41','ath_5', 'sprint_20', 60, 3.01),
    seedTestResult('t42','ath_5', 'ift_30_15', 60, 19.5),

    seedTestResult('t50','ath_6', 'cmj',       60, 35.9),
    seedTestResult('t51','ath_6', 'sprint_20', 60, 3.18),
    seedTestResult('t52','ath_6', 'yyir1',     60, 1560),
    seedTestResult('t53','ath_6', 'iso_add',   60, 285),

    seedTestResult('t60','ath_7', 'cmj',       60, 41.8),
    seedTestResult('t61','ath_7', 'broad',     60, 245),
    seedTestResult('t62','ath_7', 'yyir1',     60, 1920),

    seedTestResult('t70','ath_8', 'cmj',       60, 37.5),
    seedTestResult('t71','ath_8', 'sprint_20', 60, 3.08),
    seedTestResult('t72','ath_8', 'yyir1',     60, 1780),

    // Mid-season retest (~14 days ago) — selected athletes
    seedTestResult('t100','ath_1', 'cmj',       14, 39.6, { enteredBy: 'A. Reeves' }),
    seedTestResult('t101','ath_1', 'yyir1',     14, 1960),
    seedTestResult('t102','ath_2', 'cmj',       14, 41.8),
    seedTestResult('t103','ath_2', 'tt_2k',     14, '6:35'),
    seedTestResult('t104','ath_3', 'cmj',       14, 37.5),
    seedTestResult('t105','ath_4', 'nordic',    14, 268, { notes: 'Improved from pre-season. Continue NHE protocol.' }),
    seedTestResult('t106','ath_5', 'cmj',       14, 40.2),
    seedTestResult('t107','ath_8', 'cmj',       14, 38.1),
  ];

  // ===== Concussion baselines =====
  const teamConcussionBaselines = teamAthletes.map((a, i) => ({
    id: `cb_${a.id}`,
    athleteId: a.id,
    date: offsetDate(-90 + (i * 2)),  // staggered across pre-season
    administeredBy: 'Dr. Patel',
    // SCAT6-style baseline scores
    symptomScore: i % 3 === 0 ? 2 : 0,       // 0-132, baseline usually low
    symptomSeverity: i % 3 === 0 ? 3 : 0,    // 0-132
    orientationScore: 5,                      // /5
    immediateMemory: 9 + (i % 2),             // /10
    delayedMemory: 8 + (i % 3),               // /10
    concentration: 4,                         // /5
    mBESS: 2 + (i % 4),                       // /30 — errors, lower = better
    tandemGait: 11.5 + (i * 0.2),            // seconds, lower = better
    previousConcussions: i === 0 ? 1 : (i === 6 ? 2 : 0),
    notes: i === 6 ? 'Prior concussion history. Annual baseline mandatory.' : ''
  }));

  // ===== Concussion incidents — Sophie had one in pre-season =====
  const teamConcussionIncidents = [
    {
      id: 'ci_1',
      athleteId: 'ath_8',
      date: offsetDate(-32),
      mechanism: 'Tackle / contact',
      witnessedBy: 'Coach Reeves',
      lossOfConsciousness: false,
      symptomScoreAcute: 18,
      currentRTPStage: 6,
      diagnosisBy: 'Dr. Patel',
      clearedOn: offsetDate(-14),
      notes: 'Standard 6-stage RTP completed without setback. Cleared for full play.'
    }
  ];

  // ===== Files (mock metadata only — no real uploads in demo) =====
  const teamFiles = [
    { id: 'f1', athleteId: 'ath_1', name: 'Pre-season screening — Mercer.pdf',  type: 'screening',  date: offsetDate(-65), uploadedBy: 'Dr. Patel', uploadedByRole: 'staff', sharedWithStaff: true, sizeKb: 412 },
    { id: 'f2', athleteId: 'ath_4', name: 'MRI report — L hamstring.pdf',       type: 'imaging',    date: offsetDate(-7),  uploadedBy: 'Dr. Patel', uploadedByRole: 'staff', sharedWithStaff: true, sizeKb: 1820 },
    { id: 'f3', athleteId: 'ath_7', name: 'Shoulder ROM assessment.pdf',         type: 'assessment', date: offsetDate(-4),  uploadedBy: 'Dr. Patel', uploadedByRole: 'staff', sharedWithStaff: true, sizeKb: 230 },
    { id: 'f4', athleteId: 'ath_8', name: 'SCAT6 baseline — Bremner.pdf',       type: 'concussion', date: offsetDate(-90), uploadedBy: 'Dr. Patel', uploadedByRole: 'staff', sharedWithStaff: true, sizeKb: 380 },
    { id: 'f5', athleteId: 'ath_8', name: 'Concussion clearance letter.pdf',    type: 'concussion', date: offsetDate(-14), uploadedBy: 'Dr. Patel', uploadedByRole: 'staff', sharedWithStaff: true, sizeKb: 145 },
    { id: 'f6', athleteId: 'ath_2', name: 'PARQ + medical history.pdf',         type: 'questionnaire', date: offsetDate(-80), uploadedBy: 'S. Voss', uploadedByRole: 'staff', sharedWithStaff: true, sizeKb: 220 },
    // Athlete-uploaded examples
    { id: 'f7', athleteId: 'ath_1', name: 'GP medical certificate.pdf',         type: 'medical',    date: offsetDate(-3),  uploadedBy: 'Tom Mercer', uploadedByRole: 'athlete', sharedWithStaff: true, sizeKb: 88 },
    { id: 'f8', athleteId: 'ath_4', name: 'Hamstring rehab video.mp4',           type: 'video',      date: offsetDate(-2),  uploadedBy: 'Noah Whitfield', uploadedByRole: 'athlete', sharedWithStaff: true, sizeKb: 4400 },
    { id: 'f9', athleteId: 'ath_2', name: 'Personal training log Q1.pdf',       type: 'other',      date: offsetDate(-5),  uploadedBy: 'Liam Hartley', uploadedByRole: 'athlete', sharedWithStaff: false, sizeKb: 156 }
  ];

  // ============================================================
  // USERS & ATHLETE LINKS
  // The access-control model: every user has links to athletes,
  // each link carrying a role and granular permissions.
  // ============================================================

  // Default permission templates per link_role
  // (Matches PERMISSIONS.md from the backend schema)
  const PERM_TEMPLATES = {
    self: {
      view_basic: true, view_workouts: true, view_wellness: true,
      view_injuries: true, view_medical: true, view_gps: true,
      view_hr: true, view_notes: true, view_reports: true, view_export: true,
      edit_profile: true, edit_workouts: true, edit_injuries: true, edit_notes: true
    },
    head_coach: {
      view_basic: true, view_workouts: true, view_wellness: true,
      view_injuries: true, view_gps: true, view_hr: true,
      view_notes: true, view_reports: true,
      edit_notes: true
      // No view_medical, no edit_workouts, no edit_injuries
    },
    sc_coach: {
      view_basic: true, view_workouts: true, view_wellness: true,
      view_injuries: true, view_gps: true, view_hr: true,
      view_notes: true, view_reports: true,
      edit_workouts: true, edit_notes: true
    },
    physio: {
      view_basic: true, view_workouts: true, view_wellness: true,
      view_injuries: true, view_medical: true,
      view_notes: true, view_reports: true,
      edit_injuries: true, edit_notes: true
    },
    consultant: {
      view_basic: true, view_workouts: true, view_wellness: true,
      view_injuries: true, view_gps: true,
      view_notes: true, view_reports: true, view_export: true,
      edit_notes: true
    },
    club_admin: {
      view_basic: true, view_reports: true,
      edit_profile: true, edit_team_membership: true
      // Club admins manage the roster; they do NOT see athlete training/medical
      // data unless individually linked with appropriate permissions
    }
  };

  // Users — login accounts
  const teamUsers = [
    // Staff
    { id: 'usr_admin',   name: 'Sarah Voss',     email: 'admin@marlborough.fc',    role: 'club_admin',
      title: 'Club Administrator', orgRole: 'admin', isStaff: true, avatar: 'SV',
      phone: '+61 412 555 201',
      contactSharing: { phone: true, email: true }, contactNote: 'Office hours, Mon–Fri.' },
    { id: 'usr_sc',      name: 'Adam Reeves',    email: 'sc@marlborough.fc',       role: 'sc_coach',
      title: 'Head of S&C',         orgRole: 'coach', isStaff: true, avatar: 'AR',
      phone: '+61 412 555 202',
      contactSharing: { phone: true, email: true },
      // Adam is also an athlete — runs marathons. Both roles on one user.
      athleteId: 'ath_adam' },
    { id: 'usr_physio',  name: 'Dr. Anika Patel',email: 'physio@marlborough.fc',   role: 'physio',
      title: 'Club Physio',         orgRole: 'clinician', isStaff: true, avatar: 'AP',
      phone: '+61 412 555 203',
      contactSharing: { phone: true, email: true }, contactNote: 'Clinic Tue/Thu. Urgent: call.' },
    { id: 'usr_consult', name: 'Jordan Hayes',   email: 'consultant@apex.co',      role: 'consultant',
      title: 'External Consultant', orgRole: 'consultant', isStaff: true, avatar: 'JH',
      phone: '+61 412 555 204',
      contactSharing: { phone: false, email: true }, contactNote: 'Best by email.' },
    { id: 'usr_coach',   name: 'Mark Connolly',  email: 'coach@marlborough.fc',    role: 'head_coach',
      title: 'Head Coach',          orgRole: 'coach', isStaff: true, avatar: 'MC',
      phone: '+61 412 555 205',
      contactSharing: { phone: true, email: true } },
    // Athletes (self-link accounts) — only some athletes have claimed accounts
    { id: 'usr_tom',     name: 'Tom Mercer',     email: 'tom.mercer@example.com',  role: 'athlete',
      athleteId: 'ath_1', isStaff: false, avatar: 'TM' },
    { id: 'usr_liam',    name: 'Liam Hartley',   email: 'liam.hartley@example.com',role: 'athlete',
      athleteId: 'ath_2', isStaff: false, avatar: 'LH' },
    { id: 'usr_mia',     name: 'Mia Pereira',    email: 'mia.pereira@example.com', role: 'athlete',
      athleteId: 'ath_6', isStaff: false, avatar: 'MP' },
    // Independent athletes — no club affiliation. Mass-market users.
    { id: 'usr_priya',   name: 'Priya Naidu',    email: 'priya.naidu@example.com', role: 'athlete',
      athleteId: 'ath_priya', isStaff: false, avatar: 'PN',
      independent: true },
    { id: 'usr_felix',   name: 'Felix Yamamoto', email: 'felix.y@example.com',     role: 'athlete',
      athleteId: 'ath_felix', isStaff: false, avatar: 'FY',
      independent: true }
  ];

  // Athlete links — who can access whose data, with what permissions
  // The S&C coach and head coach are linked to ALL athletes.
  // The physio is linked to all athletes (medical scope).
  // The consultant is linked to a subset (Tom, Liam, Noah only — partial engagement).
  // Each athlete has a self-link if they have an account.
  // Independent athletes (Adam, Priya, Felix) are NOT linked to club staff by default —
  // their access comes from explicit cross-club seeded links below.
  const teamAthleteLinks = [];
  const clubAthletes = teamAthletes.filter(a => a.team); // skip independents

  // S&C coach: full squad
  clubAthletes.forEach(a => {
    teamAthleteLinks.push({
      id: `lnk_sc_${a.id}`,
      athleteId: a.id,
      userId: 'usr_sc',
      role: 'sc_coach',
      status: 'active',
      permissions: { ...PERM_TEMPLATES.sc_coach },
      acceptedAt: offsetDate(-90),
      revokedAt: null
    });
  });

  // Head coach: full squad
  clubAthletes.forEach(a => {
    teamAthleteLinks.push({
      id: `lnk_hc_${a.id}`,
      athleteId: a.id,
      userId: 'usr_coach',
      role: 'head_coach',
      status: 'active',
      permissions: { ...PERM_TEMPLATES.head_coach },
      acceptedAt: offsetDate(-90),
      revokedAt: null
    });
  });

  // Physio: full squad with medical scope
  clubAthletes.forEach(a => {
    teamAthleteLinks.push({
      id: `lnk_ph_${a.id}`,
      athleteId: a.id,
      userId: 'usr_physio',
      role: 'physio',
      status: 'active',
      permissions: { ...PERM_TEMPLATES.physio },
      acceptedAt: offsetDate(-90),
      revokedAt: null
    });
  });

  // Consultant: only ath_1 (Tom), ath_2 (Liam), ath_4 (Noah)
  ['ath_1', 'ath_2', 'ath_4'].forEach(athId => {
    teamAthleteLinks.push({
      id: `lnk_cs_${athId}`,
      athleteId: athId,
      userId: 'usr_consult',
      role: 'consultant',
      status: 'active',
      permissions: { ...PERM_TEMPLATES.consultant },
      acceptedAt: offsetDate(-45),
      expiresAt: offsetDate(90),
      revokedAt: null
    });
  });

  // Club admin: link only for roster management (no data access by default)
  clubAthletes.forEach(a => {
    teamAthleteLinks.push({
      id: `lnk_ad_${a.id}`,
      athleteId: a.id,
      userId: 'usr_admin',
      role: 'club_admin',
      status: 'active',
      permissions: { ...PERM_TEMPLATES.club_admin },
      acceptedAt: offsetDate(-180),
      revokedAt: null
    });
  });

  // Self-links for athletes with accounts
  [
    { userId: 'usr_tom',   athleteId: 'ath_1' },
    { userId: 'usr_liam',  athleteId: 'ath_2' },
    { userId: 'usr_mia',   athleteId: 'ath_6' },
    { userId: 'usr_sc',    athleteId: 'ath_adam' },   // Adam manages his own athlete profile
    { userId: 'usr_priya', athleteId: 'ath_priya' },
    { userId: 'usr_felix', athleteId: 'ath_felix' }
  ].forEach(({ userId, athleteId }) => {
    teamAthleteLinks.push({
      id: `lnk_self_${athleteId}`,
      athleteId,
      userId,
      role: 'self',
      status: 'active',
      permissions: { ...PERM_TEMPLATES.self },
      acceptedAt: offsetDate(-60),
      revokedAt: null
    });
  });

  // Cross-club / private practice links — demonstrate that staff work across orgs.
  // Dr. Patel sees Priya & Felix as private clients (not Marlborough FC).
  // Jordan Hayes consults on Priya's ultra prep.
  [
    { userId: 'usr_physio',  athleteId: 'ath_priya', role: 'physio',
      permissions: { ...PERM_TEMPLATES.physio }, accepted: -45 },
    { userId: 'usr_physio',  athleteId: 'ath_felix', role: 'physio',
      permissions: { ...PERM_TEMPLATES.physio }, accepted: -20 },
    { userId: 'usr_consult', athleteId: 'ath_priya', role: 'consultant',
      permissions: { ...PERM_TEMPLATES.consultant }, accepted: -30, expires: 60 }
  ].forEach((l, i) => {
    teamAthleteLinks.push({
      id: `lnk_cross_${i}`,
      athleteId: l.athleteId,
      userId: l.userId,
      role: l.role,
      status: 'active',
      permissions: l.permissions,
      acceptedAt: offsetDate(l.accepted),
      expiresAt: l.expires ? offsetDate(l.expires) : null,
      revokedAt: null,
      invitedByAthlete: true  // these were athlete-initiated invites
    });
  });

  // Seed an audit log so the consent screen has something to show
  const teamAuditLog = [
    { id: 'au_1', occurredAt: offsetDate(-2) + 'T14:23:00Z',
      actorUserId: 'usr_physio', athleteId: 'ath_1',
      action: 'view_medical', detail: 'Viewed medical profile' },
    { id: 'au_2', occurredAt: offsetDate(-2) + 'T14:24:00Z',
      actorUserId: 'usr_physio', athleteId: 'ath_1',
      action: 'view_injuries', detail: 'Opened injury history' },
    { id: 'au_3', occurredAt: offsetDate(-1) + 'T09:15:00Z',
      actorUserId: 'usr_sc', athleteId: 'ath_1',
      action: 'view_workouts', detail: 'Viewed 28-day workload' },
    { id: 'au_4', occurredAt: offsetDate(-1) + 'T11:42:00Z',
      actorUserId: 'usr_consult', athleteId: 'ath_1',
      action: 'view_reports', detail: 'Generated athlete report' },
    { id: 'au_5', occurredAt: offsetDate(0) + 'T08:01:00Z',
      actorUserId: 'usr_sc', athleteId: 'ath_2',
      action: 'view_workouts', detail: 'Viewed weekly load' }
  ];

  return {
    teamAthletes, teamWorkouts, teamWellness, teamNotes,
    teamInjuries, teamTests, teamConcussionBaselines,
    teamConcussionIncidents, teamFiles,
    teamUsers, teamAthleteLinks, teamAuditLog,
    PERM_TEMPLATES
  };
};

// Module-level cache so all components share the same dataset
let _seedCache = null;
const getSeedData = () => {
  if (!_seedCache) _seedCache = generateSeedData();
  return _seedCache;
};

// Resets the cache (used by the "Wipe & re-seed" button)
const resetSeedData = () => { _seedCache = null; return getSeedData(); };

// ============================================================
// Permission helpers — used everywhere to gate access
// ============================================================

// Active link between a user and an athlete, or null
const findLink = (userId, athleteId, links) => {
  return (links || []).find(l =>
    l.userId === userId &&
    l.athleteId === athleteId &&
    l.status === 'active' &&
    (!l.expiresAt || new Date(l.expiresAt) > new Date()) &&
    !l.revokedAt
  );
};

// Can the current user access the given athlete with this permission?
// permission: 'view_basic', 'view_workouts', 'view_medical', 'edit_notes', etc.
const canAccess = (user, athleteId, permission, links) => {
  if (!user) return false;
  // Athlete accessing their own data — always allowed
  if (!user.isStaff && user.athleteId === athleteId) return true;
  const link = findLink(user.id, athleteId, links);
  if (!link) return false;
  // Self-link has all permissions
  if (link.role === 'self') return true;
  return Boolean(link.permissions && link.permissions[permission]);
};

// All athlete IDs the current user has any access to
const accessibleAthleteIds = (user, links) => {
  if (!user) return [];
  if (!user.isStaff && user.athleteId) return [user.athleteId];
  const ids = (links || [])
    .filter(l => l.userId === user.id && l.status === 'active' && !l.revokedAt)
    .filter(l => !l.expiresAt || new Date(l.expiresAt) > new Date())
    .map(l => l.athleteId);
  return [...new Set(ids)];
};

// Friendly role label
const ROLE_LABELS = {
  head_coach: 'Head Coach',
  sc_coach: 'S&C Coach',
  physio: 'Physio',
  consultant: 'Consultant',
  club_admin: 'Club Admin',
  athlete: 'Athlete',
  practitioner: 'Practitioner',
  self: 'You'
};

// Friendly action label for audit log
const AUDIT_ACTION_LABELS = {
  view_basic: 'Viewed profile',
  view_workouts: 'Viewed training data',
  view_wellness: 'Viewed wellness',
  view_injuries: 'Viewed injury record',
  view_medical: 'Viewed medical detail',
  view_gps: 'Viewed GPS data',
  view_hr: 'Viewed heart rate',
  view_notes: 'Viewed notes',
  view_reports: 'Generated report',
  view_export: 'Exported data',
  edit_notes: 'Edited notes',
  edit_injuries: 'Updated injury',
  edit_workouts: 'Edited workout'
};


// ============================================================
// Visual primitives
// ============================================================
const Sparkline = ({ data, max, height = 36, color = '#1a1a1a' }) => {
  if (!data || !data.length) return null;
  const w = 100;
  const m = max || Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * w;
    const y = height - (v / m) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const Bars = ({ data, max, height = 60 }) => {
  if (!data || !data.length) return null;
  const m = max || Math.max(...data.map(d => d.load), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
      {data.map((d, i) => {
        const h = m > 0 ? (d.load / m) * (height - 14) : 0;
        const dt = new Date(d.date);
        const isToday = d.date === today();
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: '100%',
              height: Math.max(h, 2),
              background: isToday ? '#c8472b' : d.load > 0 ? '#1a1a1a' : '#e8e4dc',
              borderRadius: 1
            }} />
            <span style={{ fontSize: 9, color: '#8a8275', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {['S','M','T','W','T','F','S'][dt.getDay()]}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================
// ATHLETE APP
// ============================================================
function AthleteApp({ currentUser, demoAthleteId, realAthlete, auditLog, recordAudit, onSwitchView, onOpenSwitcher, onLogout }) {
  // The athlete this app instance is driving. For a real logged-in athlete this
  // is their DB id (workouts read/write to Supabase, M3); for a demo persona it's
  // the seed id (in-memory). `isRealAthlete` gates the DB path.
  const isRealAthlete = !!realAthlete;
  const [view, setView] = useState('home'); // home | logWorkout | wellness | rpePrompt | history | files | editWorkout
  const [editingWorkout, setEditingWorkout] = useState(null);
  const [workouts, setWorkouts] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [files, setFiles] = useState([]);
  const [injuries, setInjuries] = useState([]);
  const [coordinationNotes, setCoordinationNotes] = useState([]);
  const [editingInjury, setEditingInjury] = useState(null);
  const [links, setLinks] = useState([]);
  const [demoAthlete, setDemoAthlete] = useState(null);

  // Wellness preferences — owned by the athlete. Default: daily, all enabled.
  // High-level athletes have specifically asked for ability to reduce cadence or opt out.
  const [wellnessSettings, setWellnessSettings] = useState({
    frequency: 'daily', // daily | three_per_week | weekly | off
    enabledFields: {
      fatigue: true, soreness: true, sleep: true,
      stress: true, mood: true, motivation: true
    }
  });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    setLoading(true);
    const seed = getSeedData();
    setLinks(seed.teamAthleteLinks || []);

    if (isRealAthlete) {
      // Real DB-backed athlete. Workouts (M3) + wellness (M4) come from Supabase;
      // the remaining domains (files, injuries, notes) stay empty/in-memory until
      // their own milestones migrate them (M10, M7, M6).
      setDemoAthlete(realAthlete);
      if (realAthlete.wellnessSettings) setWellnessSettings(realAthlete.wellnessSettings);
      setFiles([]);
      setInjuries([]);
      setCoordinationNotes([]);
      let active = true;
      Promise.all([
        WorkoutsData.listWorkouts(realAthlete.id),
        WellnessData.listWellness(realAthlete.id),
      ])
        .then(([ws, cs]) => { if (active) { setWorkouts(ws); setCheckins(cs); } })
        .catch(() => { if (active) { setWorkouts([]); setCheckins([]); showToast('Could not load your data'); } })
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }

    if (demoAthleteId) {
      setWorkouts(seed.teamWorkouts.filter(w => w.athleteId === demoAthleteId));
      setCheckins(seed.teamWellness.filter(c => c.athleteId === demoAthleteId));
      setFiles((seed.teamFiles || []).filter(f => f.athleteId === demoAthleteId));
      setInjuries((seed.teamInjuries || []).filter(i => i.athleteId === demoAthleteId));
      setCoordinationNotes(
        (seed.teamNotes || []).filter(n =>
          n.athleteId === demoAthleteId && n.visibility === 'athlete'
        )
      );
      const seedAthlete = seed.teamAthletes.find(a => a.id === demoAthleteId);
      setDemoAthlete(seedAthlete || null);
      // Pick up the athlete's seeded wellness preferences if present
      if (seedAthlete?.wellnessSettings) {
        setWellnessSettings(seedAthlete.wellnessSettings);
      }
    } else {
      // Fresh start mode — empty arrays, in-memory only
      setWorkouts([]);
      setCheckins([]);
      setFiles([]);
      setInjuries([]);
      setCoordinationNotes([]);
      setDemoAthlete(null);
    }
    setLoading(false);
  }, [demoAthleteId, isRealAthlete, realAthlete]);

  // Athlete-initiated invitation — creates an active or pending link for THIS athlete
  const createLink = (invite) => {
    const myAthleteId = realAthlete?.id || demoAthleteId || currentUser?.athleteId;
    if (!myAthleteId) return;
    const seed = getSeedData();
    const allUsers = seed.teamUsers || [];
    // Resolve email to existing user if possible
    const matchedUser = invite.invitedEmail
      ? allUsers.find(u => u.email.toLowerCase() === invite.invitedEmail.toLowerCase())
      : null;
    const newLink = {
      id: `lnk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      athleteId: myAthleteId,
      userId: matchedUser ? matchedUser.id : null,
      invitedEmail: matchedUser ? null : invite.invitedEmail,
      invitedName: invite.invitedName || null,
      role: invite.role,
      permissions: { ...invite.permissions },
      status: matchedUser ? 'active' : 'pending',
      acceptedAt: matchedUser ? today() : null,
      expiresAt: invite.expiresAt || null,
      revokedAt: null,
      createdAt: today(),
      invitedByAthlete: true
    };
    setLinks([...links, newLink]);
    showToast(matchedUser ? `${matchedUser.name} now has access` : 'Invitation sent');
    return newLink;
  };

  const revokeLink = (linkId) => {
    setLinks(links.map(l =>
      l.id === linkId
        ? { ...l, status: 'revoked', revokedAt: new Date().toISOString() }
        : l
    ));
    showToast('Access revoked');
  };

  const saveWorkout = async (w) => {
    if (isRealAthlete) {
      try {
        if (w.id) {
          const updated = await WorkoutsData.updateWorkout(w.id, w);
          setWorkouts(prev => prev.map(x => (x.id === updated.id ? updated : x)));
          showToast('Session updated');
        } else {
          const created = await WorkoutsData.createWorkout(realAthlete.id, w, currentUser?.id);
          setWorkouts(prev => [...prev, created]);
          showToast(w.date === today() ? 'Session logged' : 'Past session added');
        }
      } catch (e) {
        console.error('saveWorkout', e);
        showToast('Could not save session');
      }
      return;
    }
    // Demo / in-memory path
    if (w.id) {
      setWorkouts(workouts.map(x => x.id === w.id ? { ...x, ...w } : x));
      showToast('Session updated');
    } else {
      const newEntry = { ...w, id: `w_${Date.now()}` };
      setWorkouts([...workouts, newEntry]);
      showToast(w.date === today() ? 'Session logged' : 'Past session added');
    }
  };

  const deleteWorkout = async (id) => {
    if (isRealAthlete) {
      try {
        await WorkoutsData.deleteWorkout(id);
        setWorkouts(prev => prev.filter(w => w.id !== id));
        showToast('Session deleted');
      } catch (e) {
        console.error('deleteWorkout', e);
        showToast('Could not delete session');
      }
      return;
    }
    setWorkouts(workouts.filter(w => w.id !== id));
    showToast('Session deleted');
  };

  const saveInjury = (inj) => {
    if (inj.id) {
      // Editing existing
      setInjuries(injuries.map(x => x.id === inj.id ? { ...x, ...inj } : x));
      showToast('Injury updated');
    } else {
      const myAthleteId = realAthlete?.id || demoAthleteId || currentUser?.athleteId;
      const newEntry = {
        ...inj,
        id: `inj_${Date.now()}`,
        athleteId: myAthleteId,
        reportedOn: today(),
        reportedBy: currentUser?.name || 'Self-reported',
        selfReported: true,
        status: inj.status || 'out',
        // Default RTP progression for an athlete self-report — a generic ladder.
        // Staff can customise once they see it.
        rtpProgress: inj.rtpProgress || [
          { stage: 'Pain settled at rest', achieved: false, date: null },
          { stage: 'Full pain-free range of motion', achieved: false, date: null },
          { stage: 'Strength symmetry restored', achieved: false, date: null },
          { stage: 'Modified training tolerated', achieved: false, date: null },
          { stage: 'Cleared for full training', achieved: false, date: null },
          { stage: 'Cleared for match / competition', achieved: false, date: null }
        ]
      };
      setInjuries([newEntry, ...injuries]);
      showToast('Injury logged — staff will be notified');
    }
  };

  const updateInjury = (id, patch) => {
    setInjuries(injuries.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  const saveCheckin = async (c) => {
    if (isRealAthlete) {
      try {
        const saved = await WellnessData.saveWellness(realAthlete.id, c);
        setCheckins(prev => [...prev.filter(x => x.date !== saved.date), saved]);
        showToast('Check-in saved');
      } catch (e) {
        console.error('saveCheckin', e);
        showToast('Could not save check-in');
      }
      return;
    }
    // Demo / in-memory path — replace any same-date entry
    const newEntry = { ...c, id: `c_${Date.now()}` };
    const filtered = checkins.filter(x => x.date !== c.date);
    setCheckins([...filtered, newEntry]);
    showToast('Check-in saved');
  };

  const saveFile = (f) => {
    const newF = {
      ...f,
      id: `f_${Date.now()}`,
      date: today(),
      uploadedBy: demoAthlete ? demoAthlete.name : 'You',
      uploadedByRole: 'athlete'
    };
    setFiles([newF, ...files]);
    showToast('File uploaded');
  };

  const toggleFileShared = (id) => {
    setFiles(files.map(f => f.id === id ? { ...f, sharedWithStaff: !f.sharedWithStaff } : f));
  };

  const deleteFile = (id) => {
    setFiles(files.filter(f => f.id !== id));
    showToast('File removed');
  };

  // Merge GPS / fitness data uploaded by the athlete
  const mergeUploadedSessions = (rows, opts) => {
    const choice = opts?.overwriteChoice || 'replace';
    let updated = [...workouts];
    let added = 0, replaced = 0, merged = 0, skipped = 0;

    rows.forEach(row => {
      const existingIdx = updated.findIndex(w => w.date === row.date);
      if (existingIdx >= 0) {
        if (choice === 'skip') { skipped++; return; }
        if (choice === 'replace') {
          const existing = updated[existingIdx];
          updated[existingIdx] = {
            ...existing,
            ...row,
            id: existing.id,
            rpe: row.rpe !== undefined ? row.rpe : existing.rpe,
            note: existing.note
          };
          replaced++;
        } else if (choice === 'merge') {
          const existing = updated[existingIdx];
          const m = { ...existing };
          Object.entries(row).forEach(([k, v]) => {
            if ((m[k] === undefined || m[k] === null || m[k] === '') && v !== undefined && v !== null) {
              m[k] = v;
            }
          });
          updated[existingIdx] = m;
          merged++;
        }
      } else {
        updated.push({
          ...row,
          id: `w_imp_${row.date}_${Date.now()}_${added}`,
          source: 'csv_upload',
          duration: row.durationMin || 60,
          rpe: row.rpe || null,
          type: row.sessionType || 'GPS session',
          note: ''
        });
        added++;
      }
    });

    setWorkouts(updated);
    showToast(`Imported ${added + replaced + merged} sessions`);
    return { added, replaced, merged, skipped };
  };

  if (loading) return <div style={styles.athleteFrame}><div style={{ padding: 40, textAlign: 'center', color: '#8a8275' }}>·</div></div>;

  const todayStr = today();
  const todayWorkouts = workouts.filter(w => w.date === todayStr);
  const todayCheckin = checkins.find(c => c.date === todayStr);
  const weekly = calc.weeklyLoad(workouts, todayStr);
  const acwr = calc.acwr(workouts, todayStr);
  const wellnessAvg = calc.wellnessAvg(checkins, 7, todayStr);
  const monotony = calc.monotony(workouts, todayStr);

  // Wellness-due logic respects the athlete's frequency preference.
  // - off:        never prompt
  // - daily:      always due if not done today
  // - three_per_week: due if no check-in in the past 2 days
  // - weekly:     due if no check-in in the past 6 days
  const wellnessDue = (() => {
    if (wellnessSettings.frequency === 'off') return false;
    if (todayCheckin) return false;
    if (wellnessSettings.frequency === 'daily') return true;
    const daysBack = wellnessSettings.frequency === 'three_per_week' ? 2 : 6;
    const cutoff = new Date(todayStr);
    cutoff.setDate(cutoff.getDate() - daysBack);
    return !checkins.some(c => new Date(c.date) > cutoff);
  })();
  const wellnessOff = wellnessSettings.frequency === 'off';

  // Status interpretation — vague, athlete-friendly
  let loadStatus = { label: 'Stable', tone: 'neutral' };
  if (weekly.total === 0) loadStatus = { label: 'No load this week', tone: 'neutral' };
  else if (acwr && acwr > 1.5) loadStatus = { label: 'Higher than usual', tone: 'warn' };
  else if (acwr && acwr < 0.7) loadStatus = { label: 'Lower than usual', tone: 'neutral' };

  // Recommendation engine — single sentence
  const recommend = () => {
    if (!todayWorkouts.length && !todayCheckin && wellnessDue) return 'Open the day with a quick wellness check-in.';
    if (acwr && acwr > 1.5) return 'Your workload has increased quickly this week. Consider how you pace the next few sessions.';
    if (monotony && monotony > 2 && weekly.total > 200) return 'Your training week has had little variation. Mixing intensities may help.';
    if (wellnessAvg && wellnessAvg > 4 && !wellnessOff) return 'Recovery markers are trending down. Notice how you feel over the next few sessions.';
    if (weekly.total > 0 && acwr && acwr < 0.7) return 'Workload is lighter than your recent baseline — a good week to build steadily.';
    if (todayWorkouts.length && !todayCheckin && wellnessDue) return 'A quick wellness check-in rounds out the day.';
    return 'Training load is stable. Stay consistent.';
  };

  // ---- HOME ----
  if (view === 'home') {
    return (
      <div style={styles.athleteFrame}>
        <Toast msg={toast} />

        {/* Top brand bar */}
        <div style={styles.aTopBar}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={styles.brandMark}>◐</span>
            <span style={styles.brandWord}>tempo</span>
          </div>
          <UserBadge
            user={currentUser}
            onSwitch={onOpenSwitcher}
            onLogout={onLogout}
          />
        </div>

        {/* Dual-identity mode switcher — shown when the user is staff */}
        {currentUser?.isStaff && (
          <div style={styles.dualModeSwitcher}>
            <button style={{ ...styles.dualModeBtn, ...styles.dualModeBtnActive }}>
              <span style={styles.dualModeBtnIcon}>◐</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={styles.dualModeBtnLabel}>My training</div>
                <div style={styles.dualModeBtnSub}>Athlete view</div>
              </div>
            </button>
            <button onClick={onSwitchView} style={styles.dualModeBtn}>
              <span style={{ ...styles.dualModeBtnIcon, opacity: 0.5 }}>○</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={styles.dualModeBtnLabel}>Practitioner</div>
                <div style={styles.dualModeBtnSub}>{currentUser.title || ROLE_LABELS[currentUser.role]}</div>
              </div>
            </button>
          </div>
        )}

        <div style={styles.aGreet}>
          <div style={styles.aDay}>{new Date().toLocaleDateString('en-AU', { weekday: 'long' })}</div>
          <h1 style={styles.aHello}>
            {workouts.length === 0 && checkins.length === 0
              ? `Welcome, ${(currentUser?.name || '').split(' ')[0] || 'there'}`
              : 'How was today?'}
          </h1>
        </div>

        {/* First-run welcome — only shown to brand-new athletes */}
        {workouts.length === 0 && checkins.length === 0 && (
          <div style={styles.firstRunCard}>
            <div style={styles.firstRunHead}>
              <div style={styles.firstRunIcon}>◐</div>
              <div>
                <div style={styles.firstRunTitle}>Let's get you set up</div>
                <div style={styles.firstRunSubtitle}>Three quick things to do first</div>
              </div>
            </div>

            <div style={styles.firstRunStep}>
              <div style={styles.firstRunStepNum}>1</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.firstRunStepTitle}>Log your first workout</div>
                <div style={styles.firstRunStepDesc}>Takes about 15 seconds. Manual or import from a CSV.</div>
              </div>
            </div>

            <div style={styles.firstRunStep}>
              <div style={styles.firstRunStepNum}>2</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.firstRunStepTitle}>Quick wellness check-in</div>
                <div style={styles.firstRunStepDesc}>How are you feeling today? 10 seconds, six sliders.</div>
              </div>
            </div>

            <div style={styles.firstRunStep}>
              <div style={styles.firstRunStepNum}>3</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.firstRunStepTitle}>Invite your support team</div>
                <div style={styles.firstRunStepDesc}>Physio, coach, doctor — share your data with anyone helping you train.</div>
              </div>
            </div>

            <p style={styles.firstRunNote}>
              Tempo gets useful after a week or so of data — the more sessions and check-ins you log, the better the picture becomes.
            </p>
          </div>
        )}

        {/* Today checklist */}
        <div style={styles.aSection}>
          <div style={styles.aSectionLabel}>Today</div>
          <CheckRow
            done={todayWorkouts.length > 0}
            label={todayWorkouts.length ? `${todayWorkouts.length} session${todayWorkouts.length > 1 ? 's' : ''} logged` : 'Log a session'}
            onClick={() => setView('logWorkout')}
          />
          {!wellnessOff && (
            <CheckRow
              done={!!todayCheckin || !wellnessDue}
              label={
                todayCheckin ? 'Wellness check-in done'
                : !wellnessDue ? `Wellness — next check-in ${wellnessSettings.frequency === 'weekly' ? 'this week' : 'in a few days'}`
                : 'Wellness check-in'
              }
              onClick={() => setView('wellness')}
            />
          )}
        </div>

        {/* Weekly load summary */}
        <div style={styles.aCard}>
          <div style={styles.aCardHeader}>
            <span style={styles.aCardLabel}>This week</span>
            <span style={{ ...styles.aPill, ...(loadStatus.tone === 'warn' ? styles.pillWarn : styles.pillNeutral) }}>
              {loadStatus.label}
            </span>
          </div>
          <div style={styles.aBigNum}>{weekly.total.toLocaleString()}<span style={styles.aUnit}>AU</span></div>
          <div style={{ marginTop: 14, marginBottom: 6 }}>
            <Bars data={weekly.days} height={56} />
          </div>
        </div>

        {/* Recovery — hidden when wellness check-ins are off */}
        {!wellnessOff && (
          <div style={styles.aCard}>
            <div style={styles.aCardHeader}>
              <span style={styles.aCardLabel}>Recovery</span>
              <span style={styles.aSub}>last 7 days</span>
            </div>
            {wellnessAvg !== null ? (
              <>
                <div style={styles.aBigNum}>
                  {wellnessAvg < 2 ? 'Fresh' : wellnessAvg < 3.5 ? 'Settled' : wellnessAvg < 5 ? 'Strained' : 'Drained'}
                </div>
                <div style={styles.aSub2}>Based on {checkins.filter(c => {
                  const cd = new Date(c.date), end = new Date(todayStr), cutoff = new Date(end);
                  cutoff.setDate(end.getDate() - 6);
                  return cd >= cutoff && cd <= end;
                }).length} check-ins</div>
              </>
            ) : (
              <div style={styles.aSub2}>No check-ins yet this week</div>
            )}
          </div>
        )}

        {/* The one recommendation */}
        <div style={styles.aRec}>
          <div style={styles.aRecLabel}>Today's note</div>
          <p style={styles.aRecText}>{recommend()}</p>
        </div>

        {/* Coordination notes from staff — only shown when there are unarchived athlete-visible notes */}
        {coordinationNotes.filter(n => !n.archived).length > 0 && (
          <CoordinationNotesPanel
            notes={coordinationNotes.filter(n => !n.archived)}
            onAcknowledge={(id) => {
              setCoordinationNotes(coordinationNotes.map(n =>
                n.id === id ? { ...n, acknowledged: true, acknowledgedAt: new Date().toISOString() } : n
              ));
              showToast('Got it — staff notified');
            }}
            onArchive={(id) => {
              setCoordinationNotes(coordinationNotes.map(n =>
                n.id === id ? { ...n, archived: true } : n
              ));
            }}
          />
        )}

        {/* GPS / external load widget — only shows if there's data */}
        <GpsWidget workouts={workouts} />

        <div style={styles.aBottomLinks}>
          <button style={styles.aHistoryLink} onClick={() => setView('history')}>
            History →
          </button>
          <button style={styles.aHistoryLink} onClick={() => setView('injuries')}>
            Injuries{injuries.filter(i => i.status !== 'returned').length > 0 ? ` (${injuries.filter(i => i.status !== 'returned').length} active)` : ''} →
          </button>
          <button style={styles.aHistoryLink} onClick={() => setView('files')}>
            Files →
          </button>
          <button style={styles.aHistoryLink} onClick={() => setView('importData')}>
            Import data →
          </button>
          <button style={styles.aHistoryLink} onClick={() => setView('privacy')}>
            Privacy & access →
          </button>
          <button style={styles.aHistoryLink} onClick={() => setView('settings')}>
            Settings →
          </button>
        </div>

        <div style={{ height: 24 }} />
      </div>
    );
  }

  // ---- LOG WORKOUT ----
  if (view === 'logWorkout') {
    return <LogWorkout onBack={() => setView('home')} onSave={async (w) => { await saveWorkout(w); setView('home'); }} />;
  }

  // ---- WELLNESS ----
  if (view === 'wellness') {
    return (
      <Wellness
        existing={todayCheckin}
        enabledFields={wellnessSettings.enabledFields}
        onBack={() => setView('home')}
        onSave={async (c) => { await saveCheckin(c); setView('home'); }}
      />
    );
  }

  // ---- HISTORY ----
  if (view === 'history') {
    return (
      <History
        workouts={workouts}
        checkins={checkins}
        onBack={() => setView('home')}
        onEditWorkout={(w) => { setEditingWorkout(w); setView('editWorkout'); }}
        onAddPast={() => { setEditingWorkout(null); setView('logWorkout'); }}
      />
    );
  }

  // ---- EDIT WORKOUT ----
  if (view === 'editWorkout') {
    return (
      <LogWorkout
        existing={editingWorkout}
        onBack={() => { setEditingWorkout(null); setView('history'); }}
        onSave={async (w) => {
          await saveWorkout(w);
          setEditingWorkout(null);
          setView('history');
        }}
        onDelete={async (id) => {
          await deleteWorkout(id);
          setEditingWorkout(null);
          setView('history');
        }}
      />
    );
  }

  // ---- INJURIES (athlete view) ----
  if (view === 'injuries') {
    const seed = getSeedData();
    return (
      <AthleteInjuriesView
        injuries={injuries}
        onBack={() => setView('home')}
        onReport={() => { setEditingInjury(null); setView('reportInjury'); }}
        onUpdate={updateInjury}
        currentUser={currentUser}
        links={links}
        allUsers={seed.teamUsers || []}
      />
    );
  }

  // ---- REPORT / EDIT SELF-INJURY ----
  if (view === 'reportInjury') {
    return (
      <AthleteInjuryReportForm
        existing={editingInjury}
        onBack={() => { setEditingInjury(null); setView('injuries'); }}
        onSave={async (inj) => {
          await saveInjury(inj);
          setEditingInjury(null);
          setView('injuries');
        }}
      />
    );
  }

  // ---- FILES ----
  if (view === 'files') {
    return (
      <AthleteFiles
        files={files}
        onSave={saveFile}
        onToggleShared={toggleFileShared}
        onDelete={deleteFile}
        onBack={() => setView('home')}
      />
    );
  }

  // ---- IMPORT GPS / FITNESS DATA ----
  if (view === 'importData') {
    const athleteIdForImport = demoAthleteId || 'self';
    return (
      <div style={styles.athleteFrame}>
        <SubHeader title="Import data" onBack={() => setView('home')} />
        <div style={styles.aBody}>
          <p style={styles.aFilesIntro}>
            Upload a CSV from Strava, Garmin Connect, Polar Flow, or any other GPS source.
            Each row will be matched to your training session by date.
          </p>
          <GpsUploadWizard
            mode="athlete"
            athleteId={athleteIdForImport}
            athletes={[]}
            onSave={(rows, opts) => mergeUploadedSessions(rows, opts)}
            onCancel={() => setView('home')}
          />
        </div>
      </div>
    );
  }

  // ---- PRIVACY & ACCESS ----
  if (view === 'privacy') {
    return (
      <AthletePrivacy
        athleteId={demoAthleteId}
        currentUser={currentUser}
        auditLog={auditLog}
        links={links}
        onCreateLink={createLink}
        onRevokeLink={revokeLink}
        onBack={() => setView('home')}
      />
    );
  }

  // ---- SETTINGS ----
  if (view === 'settings') {
    return (
      <AthleteSettings
        settings={wellnessSettings}
        onChange={async (s) => {
          setWellnessSettings(s); // optimistic — keep the UI responsive per toggle
          if (isRealAthlete) {
            try {
              await updateWellnessSettings(realAthlete.id, s);
              showToast('Settings saved');
            } catch (e) {
              console.error('updateWellnessSettings', e);
              showToast('Could not save settings');
            }
            return;
          }
          // Demo: mirror to seed so the practitioner side reflects the choice
          if (demoAthleteId) {
            const seed = getSeedData();
            const idx = seed.teamAthletes.findIndex(a => a.id === demoAthleteId);
            if (idx >= 0) seed.teamAthletes[idx].wellnessSettings = s;
          }
          showToast('Settings saved');
        }}
        linkedStaff={(links || []).filter(l => l.role !== 'self' && l.status === 'active')}
        onBack={() => setView('home')}
      />
    );
  }

  return null;
}

// ============================================================
// Athlete sub-views
// ============================================================
function CheckRow({ done, label, onClick }) {
  return (
    <button onClick={onClick} style={styles.checkRow}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%',
        border: done ? 'none' : '1.5px solid #b8b1a0',
        background: done ? '#1a1a1a' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {done && <Check size={13} strokeWidth={2.5} color="#f5f1e8" />}
      </span>
      <span style={{ flex: 1, textAlign: 'left', color: done ? '#8a8275' : '#1a1a1a', textDecoration: done ? 'line-through' : 'none', textDecorationColor: '#b8b1a0' }}>
        {label}
      </span>
      <ChevronRight size={18} color="#b8b1a0" />
    </button>
  );
}

function LogWorkout({ existing, onBack, onSave, onDelete }) {
  const [type, setType] = useState(existing?.type || 'Run');
  const [duration, setDuration] = useState(existing?.duration ?? 45);
  const [rpe, setRpe] = useState(existing?.rpe ?? 5);
  const [note, setNote] = useState(existing?.note || '');
  const [date, setDate] = useState(existing?.date || today());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEditing = !!existing;
  const types = ['Run', 'Strength', 'Team Training', 'Match', 'Cycle', 'Swim', 'Other'];

  const rpeDesc = (v) => {
    if (v === 0) return 'Rest / no effort';
    if (v <= 2) return 'Very easy';
    if (v <= 4) return 'Easy to moderate';
    if (v <= 6) return 'Hard but controlled';
    if (v <= 8) return 'Very hard';
    if (v === 9) return 'Near maximal';
    return 'Maximal';
  };

  return (
    <div style={styles.athleteFrame}>
      <SubHeader
        title={isEditing ? 'Edit session' : 'Log session'}
        onBack={onBack}
      />
      <div style={styles.subBody}>

        <Label>Date</Label>
        <input
          type="date"
          value={date}
          max={today()}
          onChange={e => setDate(e.target.value)}
          style={styles.textInput}
        />
        {date !== today() && (
          <div style={styles.pastSessionHint}>
            {isEditing
              ? `Editing a session from ${fmtDate(date)}`
              : `Backfilling a session from ${fmtDate(date)}`}
          </div>
        )}

        <Label>Activity</Label>
        <div style={styles.chipRow}>
          {types.map(t => (
            <button key={t} onClick={() => setType(t)}
              style={{ ...styles.chip, ...(type === t ? styles.chipActive : {}) }}>
              {t}
            </button>
          ))}
        </div>

        <Label>Duration</Label>
        <div style={styles.durRow}>
          {[20, 30, 45, 60, 75, 90].map(d => (
            <button key={d} onClick={() => setDuration(d)}
              style={{ ...styles.durBtn, ...(duration === d ? styles.durBtnActive : {}) }}>
              {d}<span style={{ fontSize: 10, opacity: 0.6 }}>m</span>
            </button>
          ))}
        </div>
        <input
          type="range" min="5" max="240" step="5"
          value={duration} onChange={e => setDuration(+e.target.value)}
          style={styles.slider}
        />
        <div style={styles.sliderVal}>{duration} min</div>

        <Label>How hard? <span style={{ color: '#8a8275', fontWeight: 400 }}>(RPE 0–10)</span></Label>
        <div style={styles.rpeBigNum}>{rpe}</div>
        <div style={styles.rpeDesc}>{rpeDesc(rpe)}</div>
        <input
          type="range" min="0" max="10" step="1"
          value={rpe} onChange={e => setRpe(+e.target.value)}
          style={styles.sliderAccent}
        />
        <div style={styles.rpeScale}>
          <span>0</span><span>5</span><span>10</span>
        </div>

        <Label>Note <span style={{ color: '#8a8275', fontWeight: 400 }}>(optional)</span></Label>
        <input
          value={note} onChange={e => setNote(e.target.value)}
          placeholder="e.g. felt heavy in the legs"
          style={styles.textInput}
        />

        <button
          style={styles.primaryBtn}
          onClick={() => onSave({
            ...(existing || {}),
            type, duration, rpe, note, date,
            source: existing?.source || 'manual',
            ...(isEditing ? { editedAt: new Date().toISOString() } : {})
          })}>
          {isEditing ? 'Save changes' : 'Save session'}
        </button>

        {isEditing && onDelete && (
          <>
            {confirmDelete ? (
              <div style={styles.deleteConfirm}>
                <div style={styles.deleteConfirmText}>
                  Delete this session permanently?
                </div>
                <div style={styles.deleteConfirmActions}>
                  <button
                    style={styles.deleteConfirmCancel}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep
                  </button>
                  <button
                    style={styles.deleteConfirmConfirm}
                    onClick={() => onDelete(existing.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button
                style={styles.dangerLinkBtn}
                onClick={() => setConfirmDelete(true)}
              >
                Delete this session
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Wellness({ existing, enabledFields, onBack, onSave }) {
  const allFields = [
    { key: 'fatigue', label: 'Fatigue', low: 'Fresh', high: 'Exhausted' },
    { key: 'soreness', label: 'Soreness', low: 'None', high: 'Severe' },
    { key: 'sleep', label: 'Sleep', low: 'Great', high: 'Poor' },
    { key: 'stress', label: 'Stress', low: 'Calm', high: 'Stressed' },
    { key: 'mood', label: 'Mood', low: 'Good', high: 'Low' },
    { key: 'motivation', label: 'Motivation', low: 'High', high: 'Flat' }
  ];
  // Respect athlete-controlled enabled fields. If no preference, show all.
  const fields = enabledFields
    ? allFields.filter(f => enabledFields[f.key] !== false)
    : allFields;

  const [vals, setVals] = useState(() => {
    const base = {};
    fields.forEach(f => { base[f.key] = existing?.[f.key] ?? 2; });
    return base;
  });

  return (
    <div style={styles.athleteFrame}>
      <SubHeader title="Wellness" onBack={onBack} />
      <div style={styles.subBody}>
        <p style={styles.wHint}>Quick read. 0 means great, 7 means rough.</p>

        {fields.map(f => (
          <div key={f.key} style={styles.wField}>
            <div style={styles.wFieldHead}>
              <span style={styles.wFieldLabel}>{f.label}</span>
              <span style={styles.wFieldVal}>{vals[f.key]}</span>
            </div>
            <input
              type="range" min="0" max="7" step="1"
              value={vals[f.key]}
              onChange={e => setVals({ ...vals, [f.key]: +e.target.value })}
              style={styles.slider}
            />
            <div style={styles.wFieldEnds}>
              <span>{f.low}</span><span>{f.high}</span>
            </div>
          </div>
        ))}

        <button
          style={styles.primaryBtn}
          onClick={() => onSave({ ...vals, date: today() })}>
          {existing ? 'Update check-in' : 'Save check-in'}
        </button>
      </div>
    </div>
  );
}

function History({ workouts, checkins, onBack, onEditWorkout, onAddPast }) {
  // Merge and sort
  const items = useMemo(() => {
    const ws = workouts.map(w => ({ kind: 'workout', ...w }));
    const cs = checkins.map(c => ({ kind: 'wellness', ...c }));
    return [...ws, ...cs].sort((a, b) => b.date.localeCompare(a.date) || (b.id || '').localeCompare(a.id || ''));
  }, [workouts, checkins]);

  return (
    <div style={styles.athleteFrame}>
      <SubHeader title="History" onBack={onBack} />
      <div style={styles.subBody}>

        {onAddPast && (
          <button
            style={styles.histAddPastBtn}
            onClick={onAddPast}
          >
            + Add past session
          </button>
        )}

        {items.length === 0 && (
          <div style={{ textAlign: 'center', color: '#8a8275', padding: 40 }}>
            Nothing logged yet.
          </div>
        )}
        {items.map((it, i) => (
          <div
            key={i}
            style={{
              ...styles.histRow,
              ...(it.kind === 'workout' && onEditWorkout ? styles.histRowTap : {})
            }}
            onClick={() => {
              if (it.kind === 'workout' && onEditWorkout) onEditWorkout(it);
            }}
          >
            <div style={styles.histDate}>
              {fmtDate(it.date)}
              {it.editedAt && <div style={styles.histEditedTag}>edited</div>}
            </div>
            {it.kind === 'workout' ? (
              <div style={styles.histBody}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={styles.histTitle}>{it.type}</span>
                  <span style={styles.histLoad}>{calc.sessionLoad(it.rpe, it.duration)} AU</span>
                </div>
                <div style={styles.histMeta}>
                  {it.duration} min · RPE {it.rpe}{it.note ? ` · ${it.note}` : ''}
                </div>
                {onEditWorkout && (
                  <div style={styles.histTapHint}>Tap to edit</div>
                )}
              </div>
            ) : (
              <div style={styles.histBody}>
                <div style={styles.histTitle}>Wellness check-in</div>
                <div style={styles.histMeta}>
                  F{it.fatigue} · S{it.soreness} · Sl{it.sleep} · St{it.stress} · M{it.mood} · Mt{it.motivation}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// AthleteFiles — athlete's own file area
// ============================================================
// ============================================================
// AthleteSettings — athlete-controlled preferences
// Currently scoped to wellness cadence and field selection.
// Designed around real feedback: high-level athletes report
// wellness-prompt fatigue and want control without losing the
// app entirely. The model is "respectful defaults, honest tradeoffs."
// ============================================================
function AthleteSettings({ settings, onChange, linkedStaff, onBack }) {
  const [draft, setDraft] = useState(settings);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fieldDefs = [
    { key: 'fatigue', label: 'Fatigue' },
    { key: 'soreness', label: 'Soreness' },
    { key: 'sleep', label: 'Sleep' },
    { key: 'stress', label: 'Stress' },
    { key: 'mood', label: 'Mood' },
    { key: 'motivation', label: 'Motivation' }
  ];

  const frequencies = [
    { k: 'daily', l: 'Daily',          desc: 'Most picture for you and your staff. Best when you\'re training hard.' },
    { k: 'three_per_week', l: '3× a week', desc: 'Lighter touch. Catches trends without daily input.' },
    { k: 'weekly', l: 'Weekly',         desc: 'Minimum useful frequency. Good for general fitness.' },
    { k: 'off',    l: 'Off',            desc: 'No check-ins. You\'ll still log workouts and use the rest of the app.' }
  ];

  const hasLinkedStaff = (linkedStaff || []).length > 0;

  const enabledCount = Object.values(draft.enabledFields).filter(Boolean).length;

  const updateFreq = (k) => {
    const next = { ...draft, frequency: k };
    setDraft(next);
    onChange(next);
  };

  const toggleField = (k) => {
    if (enabledCount === 1 && draft.enabledFields[k]) return; // keep at least one
    const next = {
      ...draft,
      enabledFields: { ...draft.enabledFields, [k]: !draft.enabledFields[k] }
    };
    setDraft(next);
    onChange(next);
  };

  return (
    <div style={styles.athleteFrame}>
      <SubHeader title="Settings" onBack={onBack} />
      <div style={styles.subBody}>

        <div style={styles.settingsGroupLabel}>Wellness check-ins</div>
        <p style={styles.settingsGroupHint}>
          How often you'd like to check in. This is your call — you can change it any time.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {frequencies.map(f => {
            const active = draft.frequency === f.k;
            return (
              <button
                key={f.k}
                onClick={() => updateFreq(f.k)}
                style={{
                  ...styles.settingsFreqBtn,
                  ...(active ? styles.settingsFreqBtnActive : {})
                }}
              >
                <span style={{
                  ...styles.settingsFreqRadio,
                  ...(active ? styles.settingsFreqRadioActive : {})
                }}>
                  {active && <span style={styles.settingsFreqRadioDot} />}
                </span>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={styles.settingsFreqLabel}>{f.l}</div>
                  <div style={styles.settingsFreqDesc}>{f.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Honest tradeoffs — only show if relevant */}
        {(draft.frequency === 'off' || draft.frequency === 'weekly') && hasLinkedStaff && (
          <div style={styles.settingsConsequence}>
            <div style={styles.settingsConsequenceTitle}>What your staff will see</div>
            <p style={styles.settingsConsequenceBody}>
              {draft.frequency === 'off'
                ? 'Your linked staff will see "Wellness off" instead of a completion %. They won\'t see fatigue or soreness trends. Workload and recovery flags that combine wellness with training data will be less informative.'
                : 'Weekly check-ins give your staff much less day-to-day signal. They\'ll still see the broad picture but may have less context if something starts to trend.'}
              {' '}You can come back here any time.
            </p>
          </div>
        )}

        {/* Per-field toggles — collapsed under "Customise" */}
        {draft.frequency !== 'off' && (
          <>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={styles.settingsAdvancedToggle}
            >
              {showAdvanced ? 'Hide ' : 'Customise '}which questions to answer
              <span style={{
                display: 'inline-block', marginLeft: 6,
                transform: showAdvanced ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.15s'
              }}>›</span>
            </button>

            {showAdvanced && (
              <div style={styles.settingsAdvancedPanel}>
                <p style={styles.settingsGroupHint}>
                  Hide questions that don't feel useful to you. Keeps the check-in shorter and more meaningful.
                </p>
                {fieldDefs.map(f => {
                  const enabled = draft.enabledFields[f.key];
                  const isLastEnabled = enabledCount === 1 && enabled;
                  return (
                    <div key={f.key} style={styles.settingsFieldRow}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.settingsFieldLabel}>{f.label}</div>
                        {isLastEnabled && (
                          <div style={styles.settingsFieldHint}>Keep at least one</div>
                        )}
                      </div>
                      <button
                        onClick={() => toggleField(f.key)}
                        disabled={isLastEnabled}
                        style={{
                          ...styles.invitePermToggle,
                          background: enabled ? '#1a1a1a' : '#e0d9c8',
                          cursor: isLastEnabled ? 'not-allowed' : 'pointer',
                          opacity: isLastEnabled ? 0.6 : 1
                        }}
                        aria-label={enabled ? 'On' : 'Off'}
                      >
                        <span style={{
                          ...styles.invitePermToggleKnob,
                          transform: enabled ? 'translateX(20px)' : 'translateX(2px)'
                        }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <div style={{ height: 28 }} />

      </div>
    </div>
  );
}


// ============================================================
// CoordinationNotesPanel — short, actionable notes from staff
// Shown on athlete home when there are active notes.
// Athletes can acknowledge ("got it") or archive (dismiss).
// ============================================================
function CoordinationNotesPanel({ notes, onAcknowledge, onArchive }) {
  return (
    <div style={styles.coordNotesPanel}>
      <div style={styles.coordNotesHead}>
        <span style={styles.coordNotesLabel}>From your team</span>
        <span style={styles.coordNotesCount}>{notes.length}</span>
      </div>
      {notes.map(n => (
        <div key={n.id} style={styles.coordNote}>
          <div style={styles.coordNoteHead}>
            <div style={styles.coordNoteAuthor}>
              <span style={styles.coordNoteAuthorName}>{n.author}</span>
              <span style={styles.coordNoteAuthorRole}>{n.role}</span>
            </div>
            <span style={styles.coordNoteDate}>{fmtShort(n.date)}</span>
          </div>
          <p style={styles.coordNoteText}>{n.text}</p>
          <div style={styles.coordNoteActions}>
            {!n.acknowledged ? (
              <button
                style={styles.coordNoteAckBtn}
                onClick={() => onAcknowledge(n.id)}
              >
                Got it
              </button>
            ) : (
              <span style={styles.coordNoteAcked}>✓ You've acknowledged this</span>
            )}
            <button
              style={styles.coordNoteArchiveBtn}
              onClick={() => onArchive(n.id)}
              aria-label="Archive"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}


// ============================================================
// AthleteInjuriesView — athlete's own view of their injuries
// Athletes can see all their own injuries (active and resolved),
// log a new self-report, and contribute to RTP milestones.
// ============================================================
function AthleteInjuriesView({ injuries, onBack, onReport, onUpdate, currentUser, links, allUsers }) {
  const active = injuries.filter(i => i.status !== 'returned');
  const resolved = injuries.filter(i => i.status === 'returned');

  return (
    <div style={styles.athleteFrame}>
      <SubHeader title="Injuries" onBack={onBack} />
      <div style={styles.subBody}>

        <button style={styles.histAddPastBtn} onClick={onReport}>
          + Report an injury
        </button>

        <p style={styles.aInjuriesIntro}>
          Logging an injury here lets the staff helping you know what's going on,
          so they can support you sooner. You can keep adding detail later.
        </p>

        {active.length === 0 && resolved.length === 0 && (
          <div style={{ textAlign: 'center', color: '#8a8275', padding: 40 }}>
            No injuries logged.
          </div>
        )}

        {active.length > 0 && (
          <>
            <div style={styles.aInjuriesGroupHead}>Active</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {active.map(inj => (
                <AthleteInjuryCard
                  key={inj.id}
                  inj={inj}
                  currentUser={currentUser}
                  links={links}
                  allUsers={allUsers}
                  onUpdate={(patch) => onUpdate(inj.id, patch)}
                />
              ))}
            </div>
          </>
        )}

        {resolved.length > 0 && (
          <>
            <div style={{ ...styles.aInjuriesGroupHead, marginTop: 24 }}>Resolved</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {resolved.map(inj => (
                <AthleteInjuryCard
                  key={inj.id}
                  inj={inj}
                  currentUser={currentUser}
                  links={links}
                  allUsers={allUsers}
                  onUpdate={(patch) => onUpdate(inj.id, patch)}
                />
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}


// Athlete-friendly summary card for one injury
function AthleteInjuryCard({ inj, currentUser, links, allUsers, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmStageUndo, setConfirmStageUndo] = useState(null);
  const days = Math.round((new Date() - new Date(inj.occurredOn)) / 86400000);
  const dotColor = inj.status === 'returned' ? '#3a8a4d'
                : inj.status === 'modified' ? '#d4a017'
                : '#c8472b';

  const statusLabel = inj.status === 'returned' ? 'Resolved'
                    : inj.status === 'modified' ? 'Modified training'
                    : 'Out';

  const rtpDone = inj.rtpProgress ? inj.rtpProgress.filter(s => s.achieved).length : 0;
  const rtpTotal = inj.rtpProgress ? inj.rtpProgress.length : 0;

  const toggleStage = (index) => {
    const stage = inj.rtpProgress[index];
    if (stage.achieved) {
      setConfirmStageUndo(index);
      return;
    }
    const newProgress = inj.rtpProgress.map((s, i) =>
      i === index ? {
        ...s, achieved: true, date: today(),
        completedBy: currentUser?.name || 'Self'
      } : s
    );
    onUpdate({ rtpProgress: newProgress });
  };

  const confirmUndoStage = () => {
    const newProgress = inj.rtpProgress.map((s, i) =>
      i === confirmStageUndo ? { ...s, achieved: false, date: null, completedBy: null } : s
    );
    onUpdate({ rtpProgress: newProgress });
    setConfirmStageUndo(null);
  };

  return (
    <div style={styles.aInjCard}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={styles.aInjCardHead}
      >
        <span style={{ ...styles.aTrafficDot, background: dotColor, marginTop: 4, marginRight: 10 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.aInjCardTitle}>
            {inj.side ? `${inj.side} ` : ''}{inj.bodyRegion}
          </div>
          <div style={styles.aInjCardMeta}>
            {statusLabel} · day {days}
            {inj.selfReported && <span style={styles.aInjSelfTag}>self-reported</span>}
          </div>
        </div>
        <ChevronRight
          size={16}
          color="#8a8275"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
        />
      </button>

      {expanded && (
        <div style={styles.aInjCardBody}>
          {/* What happened — athlete-facing summary */}
          {(inj.athleteDescription || inj.mechanism) && (
            <div style={{ marginBottom: 14 }}>
              <div style={styles.aInjLabel}>What happened</div>
              <div style={styles.aInjValue}>
                {inj.athleteDescription || `${inj.mechanism}${inj.activity ? ' during ' + inj.activity.toLowerCase() : ''}`}
              </div>
            </div>
          )}

          {inj.diagnosis && (
            <div style={{ marginBottom: 14 }}>
              <div style={styles.aInjLabel}>Diagnosis from clinician</div>
              <div style={styles.aInjValue}>{inj.diagnosis}</div>
              {inj.reportedBy && (
                <div style={styles.aInjSubMeta}>— {inj.reportedBy}</div>
              )}
            </div>
          )}

          {/* RTP progress — interactive */}
          {rtpTotal > 0 && (
            <div style={styles.aInjMilestones}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <div style={styles.aInjLabel}>Recovery milestones</div>
                <div style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 13 }}>
                  {rtpDone}/{rtpTotal}
                </div>
              </div>
              {inj.rtpProgress.map((s, i) => (
                <div key={i}>
                  <button
                    onClick={() => toggleStage(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 10px',
                      width: '100%',
                      background: s.achieved ? '#f5f1e8' : 'transparent',
                      border: 'none', borderRadius: 6,
                      cursor: 'pointer',
                      fontFamily: 'inherit', textAlign: 'left',
                      marginBottom: 4
                    }}
                  >
                    <span style={{
                      width: 20, height: 20, borderRadius: 5,
                      border: s.achieved ? '2px solid #3a8a4d' : '2px solid #c8b894',
                      background: s.achieved ? '#3a8a4d' : 'transparent',
                      color: '#fdfbf5', display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, flexShrink: 0
                    }}>
                      {s.achieved ? '✓' : ''}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: s.achieved ? '#1a1a1a' : '#5a564d' }}>
                      {s.stage}
                    </span>
                    {s.date && (
                      <span style={{ fontSize: 10, color: '#8a8275', flexShrink: 0, textAlign: 'right' }}>
                        {fmtShort(s.date)}
                        {s.completedBy && (
                          <div style={{ fontSize: 9, color: '#b8b1a0', marginTop: 1 }}>by {s.completedBy}</div>
                        )}
                      </span>
                    )}
                  </button>
                  {confirmStageUndo === i && (
                    <div style={styles.deleteConfirm}>
                      <div style={styles.deleteConfirmText}>
                        Untick "{s.stage}"? You can re-check it later.
                      </div>
                      <div style={styles.deleteConfirmActions}>
                        <button
                          style={styles.deleteConfirmCancel}
                          onClick={() => setConfirmStageUndo(null)}
                        >
                          Keep
                        </button>
                        <button
                          style={styles.deleteConfirmConfirm}
                          onClick={confirmUndoStage}
                        >
                          Yes, untick
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div style={styles.aInjMilestonesNote}>
                You and your staff can check these off together.
                Anyone with edit access can contribute.
              </div>
            </div>
          )}

          {/* What you've tried */}
          {inj.interventions && (
            <div style={{ marginTop: 14 }}>
              <div style={styles.aInjLabel}>What's been tried</div>
              <div style={styles.aInjValue}>{inj.interventions}</div>
            </div>
          )}

          {/* Pain scale */}
          {inj.painScale !== undefined && inj.painScale !== null && (
            <div style={{ marginTop: 14 }}>
              <div style={styles.aInjLabel}>Pain right now</div>
              <div style={styles.aInjValue}>{inj.painScale}/10</div>
            </div>
          )}

          {inj.expectedRTP && (
            <div style={{ marginTop: 14 }}>
              <div style={styles.aInjLabel}>Expected return</div>
              <div style={styles.aInjValue}>{fmtShort(inj.expectedRTP)}</div>
            </div>
          )}

          {/* Per-injury sharing controls */}
          <InjurySharingControls
            inj={inj}
            links={links}
            allUsers={allUsers}
            onUpdate={onUpdate}
          />

        </div>
      )}
    </div>
  );
}


// ============================================================
// InjurySharingControls — per-injury "who can see this" toggles
// Layers on top of role-based permissions:
//   - role grants medical access by default → toggle OFF excludes
//   - role denies medical access by default → toggle ON includes
// ============================================================
function InjurySharingControls({ inj, links, allUsers, onUpdate }) {
  const [expanded, setExpanded] = useState(false);

  // Find all staff linked to this athlete with view_injuries permission
  // (i.e. anyone who would see the injury exists at all)
  const linkedStaff = (links || [])
    .filter(l => l.athleteId === inj.athleteId && l.status === 'active' && l.role !== 'self')
    .map(l => {
      const user = (allUsers || []).find(u => u.id === l.userId);
      if (!user) return null;
      return { user, link: l };
    })
    .filter(Boolean)
    .filter(({ link }) => link.permissions?.view_injuries);

  if (linkedStaff.length === 0) return null;

  const sharing = inj.sharing || {};
  const excluded = sharing.excluded || [];
  const included = sharing.included || [];

  const togglePersonAccess = (userId, hasMedicalByDefault) => {
    let newExcluded = [...excluded];
    let newIncluded = [...included];
    if (hasMedicalByDefault) {
      // Default ON. Toggle: include in excluded list or remove
      if (excluded.includes(userId)) {
        newExcluded = newExcluded.filter(id => id !== userId);
      } else {
        newExcluded.push(userId);
      }
    } else {
      // Default OFF. Toggle: include in included list or remove
      if (included.includes(userId)) {
        newIncluded = newIncluded.filter(id => id !== userId);
      } else {
        newIncluded.push(userId);
      }
    }
    onUpdate({ sharing: { excluded: newExcluded, included: newIncluded } });
  };

  return (
    <div style={styles.aInjSharing}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={styles.aInjSharingHead}
      >
        <span style={styles.aInjLabel}>Who can see this injury</span>
        <ChevronRight
          size={14}
          color="#8a8275"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
        />
      </button>

      {expanded && (
        <div style={styles.aInjSharingBody}>
          <p style={styles.aInjSharingHint}>
            By default, your staff see this injury based on their role. You can adjust here
            for this specific injury.
          </p>
          {linkedStaff.map(({ user, link }) => {
            const hasMedicalByDefault = !!link.permissions?.view_medical;
            const isExcluded = excluded.includes(user.id);
            const isIncluded = included.includes(user.id);
            const effectiveAccess = isExcluded ? false
                                  : isIncluded ? true
                                  : hasMedicalByDefault;
            return (
              <div key={user.id} style={styles.aInjSharingRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.aInjSharingName}>{user.name}</div>
                  <div style={styles.aInjSharingRole}>
                    {user.title || user.role}
                    {!hasMedicalByDefault && effectiveAccess && (
                      <span style={styles.aInjSharingOverrideTag}> · medical access granted just for this</span>
                    )}
                    {hasMedicalByDefault && !effectiveAccess && (
                      <span style={styles.aInjSharingOverrideTag}> · excluded from this injury</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => togglePersonAccess(user.id, hasMedicalByDefault)}
                  style={{
                    ...styles.invitePermToggle,
                    background: effectiveAccess ? '#1a1a1a' : '#e0d9c8'
                  }}
                  aria-label={effectiveAccess ? 'Has access' : 'No access'}
                >
                  <span style={{
                    ...styles.invitePermToggleKnob,
                    transform: effectiveAccess ? 'translateX(20px)' : 'translateX(2px)'
                  }} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ============================================================
// AthleteInjuryReportForm — athlete-friendly injury self-report
// ============================================================
function AthleteInjuryReportForm({ existing, onBack, onSave }) {
  const [bodyRegion, setBodyRegion] = useState(existing?.bodyRegion || '');
  const [side, setSide] = useState(existing?.side || '');
  const [occurredOn, setOccurredOn] = useState(existing?.occurredOn || today());
  const [athleteDescription, setAthleteDescription] = useState(existing?.athleteDescription || '');
  const [whatYouFelt, setWhatYouFelt] = useState(existing?.whatYouFelt || '');
  const [interventions, setInterventions] = useState(existing?.interventions || '');
  const [painScale, setPainScale] = useState(existing?.painScale ?? 3);
  const [stillTraining, setStillTraining] = useState(existing?.stillTraining ?? null);

  const bodyRegions = [
    'Head', 'Neck', 'Shoulder', 'Upper arm', 'Elbow', 'Forearm', 'Wrist', 'Hand',
    'Chest', 'Upper back', 'Lower back',
    'Hip / groin', 'Thigh (front)', 'Thigh (back)', 'Knee', 'Calf', 'Achilles', 'Ankle', 'Foot',
    'Other'
  ];

  const sides = ['Left', 'Right', 'Both', 'N/A'];

  const canSave = bodyRegion && athleteDescription.trim().length > 0;

  return (
    <div style={styles.athleteFrame}>
      <SubHeader
        title={existing ? 'Edit injury report' : 'Report an injury'}
        onBack={onBack}
      />
      <div style={styles.subBody}>

        <p style={styles.aInjFormIntro}>
          Tell us what's going on. Don't worry about getting the wording perfect —
          a clinician will work with you on the detail. The goal is to flag it now
          so the team knows.
        </p>

        <Label>Where does it hurt?</Label>
        <div style={styles.aInjRegionGrid}>
          {bodyRegions.map(r => (
            <button
              key={r}
              onClick={() => setBodyRegion(r)}
              style={{
                ...styles.aInjRegionBtn,
                ...(bodyRegion === r ? styles.aInjRegionBtnActive : {})
              }}
            >
              {r}
            </button>
          ))}
        </div>

        {bodyRegion && bodyRegion !== 'Other' && (
          <>
            <Label>Which side?</Label>
            <div style={styles.aInjSideRow}>
              {sides.map(s => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  style={{
                    ...styles.aInjSideBtn,
                    ...(side === s ? styles.aInjSideBtnActive : {})
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        <Label>When did it happen?</Label>
        <input
          type="date"
          max={today()}
          value={occurredOn}
          onChange={e => setOccurredOn(e.target.value)}
          style={styles.textInput}
        />

        <Label>What happened? <span style={{ color: '#8a8275', fontWeight: 400 }}>(in your own words)</span></Label>
        <textarea
          value={athleteDescription}
          onChange={e => setAthleteDescription(e.target.value)}
          placeholder="e.g. Felt a sharp pull in my hamstring sprinting in training yesterday — heard a small pop"
          rows={3}
          style={{ ...styles.textInput, resize: 'vertical', minHeight: 72 }}
        />

        <Label>What did it feel like? <span style={{ color: '#8a8275', fontWeight: 400 }}>(optional)</span></Label>
        <textarea
          value={whatYouFelt}
          onChange={e => setWhatYouFelt(e.target.value)}
          placeholder="Sharp / dull / pulling / burning / catching / unstable etc."
          rows={2}
          style={{ ...styles.textInput, resize: 'vertical', minHeight: 52 }}
        />

        <Label>How much does it hurt right now? <span style={{ color: '#8a8275', fontWeight: 400 }}>(0–10)</span></Label>
        <div style={styles.rpeBigNum}>{painScale}</div>
        <div style={styles.rpeDesc}>
          {painScale === 0 ? 'No pain'
            : painScale <= 2 ? 'Mild — barely noticeable'
            : painScale <= 4 ? 'Mild discomfort'
            : painScale <= 6 ? 'Moderate — distracting'
            : painScale <= 8 ? 'Strong — hard to ignore'
            : painScale === 9 ? 'Severe'
            : 'Worst pain imaginable'}
        </div>
        <input
          type="range" min="0" max="10" step="1"
          value={painScale}
          onChange={e => setPainScale(+e.target.value)}
          style={styles.sliderAccent}
        />
        <div style={styles.rpeScale}>
          <span>0</span><span>5</span><span>10</span>
        </div>

        <Label>Can you train through it right now?</Label>
        <div style={styles.aInjSideRow}>
          {[
            { k: 'fully', l: 'Yes, normally' },
            { k: 'modified', l: 'Yes, but modified' },
            { k: 'no', l: "No, I'm out" }
          ].map(o => (
            <button
              key={o.k}
              onClick={() => setStillTraining(o.k)}
              style={{
                ...styles.aInjSideBtn,
                ...(stillTraining === o.k ? styles.aInjSideBtnActive : {})
              }}
            >
              {o.l}
            </button>
          ))}
        </div>

        <Label>Have you tried anything to help? <span style={{ color: '#8a8275', fontWeight: 400 }}>(optional)</span></Label>
        <textarea
          value={interventions}
          onChange={e => setInterventions(e.target.value)}
          placeholder="e.g. Ice, rest, foam rolling, anti-inflammatories, seen a physio…"
          rows={2}
          style={{ ...styles.textInput, resize: 'vertical', minHeight: 52 }}
        />

        <p style={styles.aInjFormNote}>
          When you submit, this is visible to the staff you've shared injury access with.
          They'll add clinical detail and update your milestones as you recover. You can
          edit any of this later.
        </p>

        <button
          style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.4 }}
          disabled={!canSave}
          onClick={() => onSave({
            ...(existing || {}),
            bodyRegion,
            side: side || 'N/A',
            occurredOn,
            athleteDescription,
            whatYouFelt,
            interventions,
            painScale,
            mechanism: 'Self-reported',
            status: stillTraining === 'fully' ? 'returned'
                  : stillTraining === 'modified' ? 'modified'
                  : 'out',
            severity: painScale >= 8 ? 4 : painScale >= 6 ? 3 : painScale >= 4 ? 2 : 1
          })}
        >
          {existing ? 'Save changes' : 'Submit injury report'}
        </button>
      </div>
    </div>
  );
}


function AthleteFiles({ files, onSave, onToggleShared, onDelete, onBack }) {
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('all'); // all | mine | shared
  const fileInputRef = React.useRef(null);

  const [pendingName, setPendingName] = useState('');
  const [pendingType, setPendingType] = useState('medical');
  const [pendingSize, setPendingSize] = useState(0);
  const [pendingShared, setPendingShared] = useState(true);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setPendingName(f.name);
      setPendingSize(Math.round(f.size / 1024));
    }
  };

  const handleSave = () => {
    if (!pendingName) return;
    onSave({
      name: pendingName,
      type: pendingType,
      sizeKb: pendingSize,
      sharedWithStaff: pendingShared
    });
    // Reset
    setPendingName('');
    setPendingSize(0);
    setPendingType('medical');
    setPendingShared(true);
    setShowAdd(false);
  };

  const visible = files.filter(f => {
    if (filter === 'mine') return f.uploadedByRole === 'athlete';
    if (filter === 'shared') return f.sharedWithStaff;
    return true;
  });

  return (
    <div style={styles.athleteFrame}>
      <SubHeader title="My files" onBack={onBack} />

      <div style={styles.aBody}>
        <p style={styles.aFilesIntro}>
          Upload medical certificates, training videos, training logs, or anything else relevant to your training.
          Files marked “shared” are visible to your coaches and clinicians.
        </p>

        {!showAdd && (
          <button style={styles.aCtaBtn} onClick={() => setShowAdd(true)}>
            + Upload file
          </button>
        )}

        {showAdd && (
          <div style={styles.aFileForm}>
            <div style={styles.aFileFormTitle}>Upload file</div>

            <div style={styles.aFileFormField}>
              <label style={styles.aFileLabel}>Choose file</label>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ fontFamily: 'inherit', fontSize: 13 }}
              />
            </div>

            {!pendingName && (
              <div style={styles.aFileFormField}>
                <label style={styles.aFileLabel}>Or enter file name</label>
                <input
                  style={styles.aFileInput}
                  value={pendingName}
                  onChange={e => setPendingName(e.target.value)}
                  placeholder="e.g. Doctor's note.pdf"
                />
              </div>
            )}

            {pendingName && (
              <div style={styles.aFilePreview}>
                <FileText size={16} color="#5a564d" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.aFilePreviewName}>{pendingName}</div>
                  {pendingSize > 0 && <div style={styles.aFilePreviewMeta}>{pendingSize}kb</div>}
                </div>
              </div>
            )}

            <div style={styles.aFileFormField}>
              <label style={styles.aFileLabel}>Type</label>
              <div style={styles.aPillRow}>
                {[
                  { k: 'medical', l: 'Medical' },
                  { k: 'video', l: 'Video' },
                  { k: 'questionnaire', l: 'Questionnaire' },
                  { k: 'training_log', l: 'Training log' },
                  { k: 'other', l: 'Other' }
                ].map(t => (
                  <button
                    key={t.k}
                    onClick={() => setPendingType(t.k)}
                    style={{ ...styles.aPillBtn, ...(pendingType === t.k ? styles.aPillBtnActive : {}) }}
                  >
                    {t.l}
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.aShareRow}>
              <label style={{ flex: 1 }}>
                <div style={styles.aFileLabel}>Share with staff</div>
                <div style={styles.aShareHint}>
                  {pendingShared
                    ? 'Visible to coaches and clinicians linked to you'
                    : 'Visible only to you'
                  }
                </div>
              </label>
              <button
                onClick={() => setPendingShared(!pendingShared)}
                style={{
                  ...styles.aToggle,
                  background: pendingShared ? '#1a1a1a' : '#e0d9c8'
                }}
                aria-label={pendingShared ? 'Shared' : 'Private'}
              >
                <span style={{
                  ...styles.aToggleKnob,
                  transform: pendingShared ? 'translateX(20px)' : 'translateX(2px)'
                }} />
              </button>
            </div>

            <div style={styles.aFileFormActions}>
              <button style={styles.aFileCancelBtn} onClick={() => { setShowAdd(false); setPendingName(''); }}>
                Cancel
              </button>
              <button style={styles.aFileSaveBtn} onClick={handleSave} disabled={!pendingName}>
                Upload
              </button>
            </div>
          </div>
        )}

        {files.length > 0 && (
          <>
            <div style={styles.aFileFilters}>
              {[
                { k: 'all', l: 'All' },
                { k: 'mine', l: 'My uploads' },
                { k: 'shared', l: 'Shared' }
              ].map(f => (
                <button
                  key={f.k}
                  onClick={() => setFilter(f.k)}
                  style={{ ...styles.aFileFilterBtn, ...(filter === f.k ? styles.aFileFilterBtnActive : {}) }}
                >
                  {f.l}
                </button>
              ))}
            </div>

            <div style={styles.aFileList}>
              {visible.map(f => (
                <div key={f.id} style={styles.aFileItem}>
                  <FileText size={18} color="#5a564d" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.aFileItemName}>{f.name}</div>
                    <div style={styles.aFileItemMeta}>
                      {f.type} · {Math.round(f.sizeKb)}kb · {fmtShort(f.date)}
                      {f.uploadedByRole === 'staff' && (
                        <span style={styles.aFileStaffBadge}> from {f.uploadedBy}</span>
                      )}
                    </div>
                  </div>
                  {f.uploadedByRole === 'athlete' ? (
                    <div style={styles.aFileItemActions}>
                      <button
                        onClick={() => onToggleShared(f.id)}
                        style={{
                          ...styles.aFileBadge,
                          background: f.sharedWithStaff ? '#e7f1e3' : '#efeadd',
                          color: f.sharedWithStaff ? '#3a8a4d' : '#8a8275'
                        }}
                        title="Toggle share"
                      >
                        {f.sharedWithStaff ? 'Shared' : 'Private'}
                      </button>
                      <button
                        onClick={() => onDelete(f.id)}
                        style={styles.aFileDelete}
                        title="Delete"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <span style={styles.aFileStaffMarker}>staff</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {files.length === 0 && !showAdd && (
          <div style={styles.aFilesEmpty}>
            No files yet. Upload a medical certificate, a training video, or anything else you want to keep alongside your training data.
          </div>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}


// ============================================================
// AthletePrivacy — consent + audit log for athletes
// ============================================================
function AthletePrivacy({ athleteId, currentUser, auditLog, links, onCreateLink, onRevokeLink, onBack }) {
  const [users, setUsers] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [permTemplates, setPermTemplates] = useState({});
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  // Local edits to contact sharing prefs and profile contact fields
  const [contactSharing, setContactSharing] = useState(null);
  const [contactNote, setContactNote] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [emailValue, setEmailValue] = useState('');

  useEffect(() => {
    const seed = getSeedData();
    setUsers(seed.teamUsers || []);
    setAthletes(seed.teamAthletes || []);
    setPermTemplates(seed.PERM_TEMPLATES || {});
  }, []);

  // The athlete this privacy screen is for
  const targetAthleteId = athleteId || currentUser?.athleteId;
  const targetAthlete = athletes.find(a => a.id === targetAthleteId);

  // Hydrate local contact state once we have the athlete
  useEffect(() => {
    if (targetAthlete && contactSharing === null) {
      const share = targetAthlete.contactSharing || {};
      setContactSharing({
        phone: share.phone ?? true,
        email: share.email ?? true,
        emergencyContact: share.emergencyContact ?? false,
        gp: share.gp ?? false
      });
      setContactNote(share.notes || '');
      setPhoneValue(targetAthlete.profile?.contactPhone || '');
      setEmailValue(targetAthlete.profile?.contactEmail || '');
    }
  }, [targetAthlete, contactSharing]);

  const toggleShare = (key) => {
    const next = { ...contactSharing, [key]: !contactSharing[key] };
    setContactSharing(next);
    // Mirror back to the shared seed so the staff Contacts view reflects it
    if (targetAthlete) {
      targetAthlete.contactSharing = {
        ...targetAthlete.contactSharing,
        [key]: next[key]
      };
    }
  };

  // Persist contact note edits back to the seed
  useEffect(() => {
    if (targetAthlete && contactSharing !== null) {
      targetAthlete.contactSharing = {
        ...targetAthlete.contactSharing,
        notes: contactNote
      };
    }
  }, [contactNote, targetAthlete, contactSharing]);

  // Persist phone/email edits back to the seed
  useEffect(() => {
    if (targetAthlete && targetAthlete.profile) {
      targetAthlete.profile.contactPhone = phoneValue;
      targetAthlete.profile.contactEmail = emailValue;
    }
  }, [phoneValue, emailValue, targetAthlete]);
  if (!targetAthleteId) {
    return (
      <div style={styles.athleteFrame}>
        <SubHeader title="Privacy & access" onBack={onBack} />
        <div style={styles.aBody}>
          <div style={styles.perfEmpty}>
            Privacy controls aren't available for fresh-start mode. Sign in as a real athlete to see them.
          </div>
        </div>
      </div>
    );
  }

  // All non-self active links for this athlete
  const accessLinks = links
    .filter(l => l.athleteId === targetAthleteId)
    .filter(l => l.role !== 'self')
    .filter(l => l.status === 'active' && !l.revokedAt);

  // Pending links (invited but not yet accepted)
  const pendingLinks = links
    .filter(l => l.athleteId === targetAthleteId)
    .filter(l => l.role !== 'self')
    .filter(l => l.status === 'pending');

  const findUser = (userId) => users.find(u => u.id === userId);

  // Audit entries for this athlete
  const athleteAuditLog = (auditLog || [])
    .filter(a => a.athleteId === targetAthleteId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  // Build a permission summary string for display
  const permSummary = (link) => {
    const p = link.permissions || {};
    const allowed = [];
    if (p.view_basic) allowed.push('Profile');
    if (p.view_workouts) allowed.push('Training');
    if (p.view_wellness) allowed.push('Wellness');
    if (p.view_injuries) allowed.push('Injuries');
    if (p.view_medical) allowed.push('Medical');
    if (p.view_gps) allowed.push('GPS / HR');
    if (p.view_notes) allowed.push('Notes');
    if (p.view_reports) allowed.push('Reports');
    return allowed;
  };

  const handleRevoke = (link) => {
    onRevokeLink?.(link.id);
    setConfirmRevoke(null);
  };

  const fmtAuditTime = (iso) => {
    const d = new Date(iso);
    const now = new Date();
    const ms = now - d;
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor(ms / 60000);
    if (days >= 2) return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    if (days === 1) return 'Yesterday';
    if (hours >= 2) return `${hours}h ago`;
    if (mins >= 2) return `${mins}m ago`;
    return 'Just now';
  };

  if (showInvite) {
    return (
      <AthleteInviteFlow
        athleteName={users.find(u => u.id === currentUser?.id)?.name || 'You'}
        permTemplates={permTemplates}
        onCreate={(payload) => {
          onCreateLink?.(payload);
          setShowInvite(false);
        }}
        onCancel={() => setShowInvite(false)}
      />
    );
  }

  return (
    <div style={styles.athleteFrame}>
      <SubHeader title="Privacy & access" onBack={onBack} />

      <div style={styles.aBody}>
        <p style={styles.aFilesIntro}>
          You control who can see your data. Below is everyone with access to your record, what
          they can view, and a log of recent activity. You can invite a clinician, coach or anyone
          else helping you — and revoke any link at any time.
        </p>

        <div style={{ marginBottom: 20 }}>
          <button style={styles.perfActionPrimary} onClick={() => setShowInvite(true)}>
            + Invite someone
          </button>
        </div>

        {/* Contact sharing */}
        {contactSharing && (
          <div style={styles.privacySection}>
            <div style={styles.privacySectionLabel}>
              Contact details you share
            </div>
            <div style={styles.contactShareCard}>
              <p style={styles.contactShareIntro}>
                Linked staff can see whatever you share here. Toggle off anything you'd rather keep private.
              </p>

              {/* Phone */}
              <div style={styles.contactShareRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.contactShareRowLabel}>Phone number</div>
                  {editingPhone ? (
                    <input
                      style={{ ...styles.perfInput, marginTop: 4 }}
                      value={phoneValue}
                      onChange={e => setPhoneValue(e.target.value)}
                      onBlur={() => setEditingPhone(false)}
                      placeholder="+61 4xx xxx xxx"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setEditingPhone(true)}
                      style={styles.contactShareValue}
                    >
                      {phoneValue || 'Add phone number'}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => toggleShare('phone')}
                  style={{
                    ...styles.invitePermToggle,
                    background: contactSharing.phone ? '#1a1a1a' : '#e0d9c8'
                  }}
                  aria-label="Toggle phone sharing"
                >
                  <span style={{
                    ...styles.invitePermToggleKnob,
                    transform: contactSharing.phone ? 'translateX(20px)' : 'translateX(2px)'
                  }} />
                </button>
              </div>

              {/* Email */}
              <div style={styles.contactShareRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.contactShareRowLabel}>Email</div>
                  {editingEmail ? (
                    <input
                      type="email"
                      style={{ ...styles.perfInput, marginTop: 4 }}
                      value={emailValue}
                      onChange={e => setEmailValue(e.target.value)}
                      onBlur={() => setEditingEmail(false)}
                      placeholder="you@example.com"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setEditingEmail(true)}
                      style={styles.contactShareValue}
                    >
                      {emailValue || 'Add email'}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => toggleShare('email')}
                  style={{
                    ...styles.invitePermToggle,
                    background: contactSharing.email ? '#1a1a1a' : '#e0d9c8'
                  }}
                  aria-label="Toggle email sharing"
                >
                  <span style={{
                    ...styles.invitePermToggleKnob,
                    transform: contactSharing.email ? 'translateX(20px)' : 'translateX(2px)'
                  }} />
                </button>
              </div>

              {/* Emergency contact */}
              <div style={styles.contactShareRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.contactShareRowLabel}>Emergency contact</div>
                  <div style={styles.contactShareSub}>
                    {targetAthlete?.profile?.emergencyName
                      ? `${targetAthlete.profile.emergencyName} (${targetAthlete.profile.emergencyRelation || 'contact'})`
                      : 'Not set'}
                  </div>
                </div>
                <button
                  onClick={() => toggleShare('emergencyContact')}
                  style={{
                    ...styles.invitePermToggle,
                    background: contactSharing.emergencyContact ? '#1a1a1a' : '#e0d9c8'
                  }}
                  aria-label="Toggle emergency contact sharing"
                >
                  <span style={{
                    ...styles.invitePermToggleKnob,
                    transform: contactSharing.emergencyContact ? 'translateX(20px)' : 'translateX(2px)'
                  }} />
                </button>
              </div>

              {/* GP / clinician */}
              <div style={styles.contactShareRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.contactShareRowLabel}>
                    GP / clinician
                    <span style={styles.contactShareTag}>medical only</span>
                  </div>
                  <div style={styles.contactShareSub}>
                    {targetAthlete?.profile?.gpName || 'Not set'}
                  </div>
                </div>
                <button
                  onClick={() => toggleShare('gp')}
                  style={{
                    ...styles.invitePermToggle,
                    background: contactSharing.gp ? '#1a1a1a' : '#e0d9c8'
                  }}
                  aria-label="Toggle GP sharing"
                >
                  <span style={{
                    ...styles.invitePermToggleKnob,
                    transform: contactSharing.gp ? 'translateX(20px)' : 'translateX(2px)'
                  }} />
                </button>
              </div>

              {/* Contact preference note */}
              <div style={{ marginTop: 12 }}>
                <div style={styles.contactShareRowLabel}>Contact preference note (optional)</div>
                <textarea
                  style={{ ...styles.perfTextarea, marginTop: 6 }}
                  rows="2"
                  value={contactNote}
                  onChange={e => setContactNote(e.target.value)}
                  placeholder="e.g. Text only — no calls before 8am."
                />
              </div>
            </div>
          </div>
        )}

        {/* Pending invitations */}
        {pendingLinks.length > 0 && (
          <div style={styles.privacySection}>
            <div style={styles.privacySectionLabel}>
              Pending invitations ({pendingLinks.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pendingLinks.map(link => (
                <div key={link.id} style={styles.privacyLinkCard}>
                  <div style={styles.privacyLinkHead}>
                    <div style={{ ...styles.privacyLinkAvatar, background: '#efeadd', color: '#8a8275' }}>
                      {(link.invitedName || link.invitedEmail || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.privacyLinkName}>
                        {link.invitedName || link.invitedEmail}
                      </div>
                      <div style={styles.privacyLinkRole}>
                        {ROLE_LABELS[link.role] || link.role}
                        {link.invitedName && link.invitedEmail && ` · ${link.invitedEmail}`}
                      </div>
                      <div style={styles.privacyLinkMeta}>
                        Invitation sent {fmtShort(link.createdAt)}
                      </div>
                    </div>
                    <span style={styles.teamAccessPendingBadge}>Pending</span>
                  </div>
                  <button
                    onClick={() => setConfirmRevoke(link)}
                    style={styles.privacyRevokeBtn}
                  >
                    Cancel invitation
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Linked users */}
        <div style={styles.privacySection}>
          <div style={styles.privacySectionLabel}>
            Linked staff ({accessLinks.length})
          </div>

          {accessLinks.length === 0 ? (
            <div style={styles.perfEmpty}>
              No one currently has access to your record.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {accessLinks.map(link => {
                const u = findUser(link.userId);
                if (!u) return null;
                const perms = permSummary(link);
                return (
                  <div key={link.id} style={styles.privacyLinkCard}>
                    <div style={styles.privacyLinkHead}>
                      <div style={styles.privacyLinkAvatar}>{u.avatar}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.privacyLinkName}>{u.name}</div>
                        <div style={styles.privacyLinkRole}>
                          {ROLE_LABELS[link.role] || link.role}
                          {u.title && ` · ${u.title}`}
                        </div>
                        <div style={styles.privacyLinkMeta}>
                          Linked {fmtShort(link.acceptedAt)}
                          {link.expiresAt && ` · expires ${fmtShort(link.expiresAt)}`}
                        </div>
                      </div>
                    </div>

                    <div style={styles.privacyPermBar}>
                      {perms.map(p => (
                        <span key={p} style={styles.privacyPermChip}>{p}</span>
                      ))}
                    </div>

                    <button
                      onClick={() => setConfirmRevoke(link)}
                      style={styles.privacyRevokeBtn}
                    >
                      Revoke access
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Audit log */}
        <div style={styles.privacySection}>
          <div style={styles.privacySectionLabel}>
            Recent activity ({athleteAuditLog.length})
          </div>

          {athleteAuditLog.length === 0 ? (
            <div style={styles.perfEmpty}>
              No activity recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {athleteAuditLog.slice(0, 30).map(entry => {
                const actor = findUser(entry.actorUserId);
                return (
                  <div key={entry.id} style={styles.privacyAuditRow}>
                    <div style={styles.privacyAuditAvatar}>{actor?.avatar || '?'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.privacyAuditAction}>
                        {AUDIT_ACTION_LABELS[entry.action] || entry.action}
                      </div>
                      <div style={styles.privacyAuditMeta}>
                        {actor?.name || 'Unknown user'} · {fmtAuditTime(entry.occurredAt)}
                      </div>
                    </div>
                  </div>
                );
              })}
              {athleteAuditLog.length > 30 && (
                <div style={{ textAlign: 'center', fontSize: 11, color: '#8a8275', marginTop: 8 }}>
                  Showing 30 most recent entries
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ height: 24 }} />
      </div>

      {/* Revoke confirmation */}
      {confirmRevoke && (
        <div
          style={styles.userSheetBackdrop}
          onClick={() => setConfirmRevoke(null)}
        >
          <div style={styles.userSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.userSheetGrip} />
            <div style={{ padding: '4px 20px 20px' }}>
              <div style={styles.userSheetName}>Revoke access?</div>
              <p style={{ fontSize: 13, color: '#5a564d', lineHeight: 1.5, marginTop: 10 }}>
                {findUser(confirmRevoke.userId)?.name} will lose access to your record. They will need to be re-invited if you want to grant access again later.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button
                  style={{ ...styles.perfCancelBtn, flex: 1 }}
                  onClick={() => setConfirmRevoke(null)}
                >
                  Cancel
                </button>
                <button
                  style={{ ...styles.perfSaveBtn, flex: 1, background: '#9c3a23' }}
                  onClick={() => handleRevoke(confirmRevoke)}
                >
                  Revoke
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// StaffPrivacy — staff member controls own contact-sharing prefs
// Mirrors changes back to the seed so the Contacts directory updates live
// ============================================================
function StaffPrivacy({ currentUser, onBack }) {
  const [users, setUsers] = useState([]);
  const [contactSharing, setContactSharing] = useState(null);
  const [contactNote, setContactNote] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [emailValue, setEmailValue] = useState('');

  useEffect(() => {
    const seed = getSeedData();
    setUsers(seed.teamUsers || []);
  }, []);

  // Find the canonical user record for the current user
  const me = users.find(u => u.id === currentUser?.id);

  // Hydrate local state from the user record
  useEffect(() => {
    if (me && contactSharing === null) {
      const share = me.contactSharing || {};
      setContactSharing({
        phone: share.phone ?? true,
        email: share.email ?? true
      });
      setContactNote(me.contactNote || '');
      setPhoneValue(me.phone || '');
      setEmailValue(me.email || '');
    }
  }, [me, contactSharing]);

  const toggleShare = (key) => {
    const next = { ...contactSharing, [key]: !contactSharing[key] };
    setContactSharing(next);
    if (me) {
      me.contactSharing = { ...me.contactSharing, [key]: next[key] };
    }
  };

  // Mirror note edits to the seed
  useEffect(() => {
    if (me && contactSharing !== null) {
      me.contactNote = contactNote;
    }
  }, [contactNote, me, contactSharing]);

  // Mirror phone/email edits to the seed
  useEffect(() => {
    if (me) {
      me.phone = phoneValue;
      me.email = emailValue;
    }
  }, [phoneValue, emailValue, me]);

  if (!me) {
    return (
      <div style={styles.pFrame}>
        <header style={styles.pHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onBack} style={styles.pBackBtn}>
              <ArrowLeft size={16} />
            </button>
            <div>
              <div style={styles.pHeaderKicker}>Privacy & sharing</div>
              <div style={styles.pOrgName}>Loading…</div>
            </div>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div style={styles.pFrame}>
      <header style={styles.pHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={styles.pBackBtn}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={styles.pHeaderKicker}>Privacy & sharing</div>
            <div style={styles.pOrgName}>Your contact details</div>
          </div>
        </div>
      </header>

      <p style={styles.aFilesIntro}>
        Other staff at the club can see whatever you share here in the team Contacts directory.
        Toggle off anything you'd rather keep private.
      </p>

      {/* Identity card — basic info, not editable here */}
      <div style={styles.staffIdentityCard}>
        <div style={{ ...styles.contactCardAvatar, background: '#1a1a1a', color: '#f5f1e8', width: 44, height: 44, fontSize: 15 }}>
          {me.avatar}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.contactCardName}>{me.name}</div>
          <div style={styles.contactCardMeta}>
            {me.title || ROLE_LABELS[me.role]}
          </div>
        </div>
      </div>

      <div style={styles.privacySection}>
        <div style={styles.privacySectionLabel}>What you share</div>
        <div style={styles.contactShareCard}>
          <p style={styles.contactShareIntro}>
            Athletes don't see this — only other staff with access to the Contacts directory.
          </p>

          {/* Phone */}
          <div style={styles.contactShareRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.contactShareRowLabel}>Phone number</div>
              {editingPhone ? (
                <input
                  style={{ ...styles.perfInput, marginTop: 4 }}
                  value={phoneValue}
                  onChange={e => setPhoneValue(e.target.value)}
                  onBlur={() => setEditingPhone(false)}
                  placeholder="+61 4xx xxx xxx"
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => setEditingPhone(true)}
                  style={styles.contactShareValue}
                >
                  {phoneValue || 'Add phone number'}
                </button>
              )}
            </div>
            <button
              onClick={() => toggleShare('phone')}
              style={{
                ...styles.invitePermToggle,
                background: contactSharing?.phone ? '#1a1a1a' : '#e0d9c8'
              }}
              aria-label="Toggle phone sharing"
            >
              <span style={{
                ...styles.invitePermToggleKnob,
                transform: contactSharing?.phone ? 'translateX(20px)' : 'translateX(2px)'
              }} />
            </button>
          </div>

          {/* Email */}
          <div style={styles.contactShareRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.contactShareRowLabel}>Email</div>
              {editingEmail ? (
                <input
                  type="email"
                  style={{ ...styles.perfInput, marginTop: 4 }}
                  value={emailValue}
                  onChange={e => setEmailValue(e.target.value)}
                  onBlur={() => setEditingEmail(false)}
                  placeholder="you@example.com"
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => setEditingEmail(true)}
                  style={styles.contactShareValue}
                >
                  {emailValue || 'Add email'}
                </button>
              )}
            </div>
            <button
              onClick={() => toggleShare('email')}
              style={{
                ...styles.invitePermToggle,
                background: contactSharing?.email ? '#1a1a1a' : '#e0d9c8'
              }}
              aria-label="Toggle email sharing"
            >
              <span style={{
                ...styles.invitePermToggleKnob,
                transform: contactSharing?.email ? 'translateX(20px)' : 'translateX(2px)'
              }} />
            </button>
          </div>

          {/* Contact preference note */}
          <div style={{ marginTop: 12 }}>
            <div style={styles.contactShareRowLabel}>Contact preference note (optional)</div>
            <textarea
              style={{ ...styles.perfTextarea, marginTop: 6 }}
              rows="2"
              value={contactNote}
              onChange={e => setContactNote(e.target.value)}
              placeholder="e.g. Clinic Tue/Thu. Urgent: call."
            />
            <p style={{ fontSize: 11, color: '#8a8275', marginTop: 6, fontStyle: 'italic' }}>
              Helps colleagues reach you in the way that works best.
            </p>
          </div>
        </div>
      </div>

      <p style={styles.aFilesIntro}>
        Looking for athlete data sharing controls? Athlete privacy is managed individually by each athlete
        from their own app.
      </p>

      <div style={{ height: 24 }} />
    </div>
  );
}


// ============================================================
// AthleteInviteFlow — athlete invites a clinician/coach to their record
// Simpler than the admin flow: always invite by email, always self-scope
// ============================================================
function AthleteInviteFlow({ athleteName, permTemplates, onCreate, onCancel }) {
  const [step, setStep] = useState('who'); // who | role | perms | confirm
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [role, setRole] = useState('physio');
  const [perms, setPerms] = useState({});
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [personalNote, setPersonalNote] = useState('');

  // Athlete-friendly roles — emphasises external clinicians since that's the
  // common use case for athlete-initiated invitations
  const roles = [
    { k: 'physio',     l: 'Physio / Physical therapist',
      desc: 'Sees your injuries, medical history, and training.' },
    { k: 'consultant', l: 'Sports doctor / GP',
      desc: 'Full read access including medical detail. Time-limited by default.' },
    { k: 'sc_coach',   l: 'Coach / Trainer',
      desc: 'Sees your training and wellness. Can leave notes.' },
    { k: 'head_coach', l: 'Performance support',
      desc: 'Sees your training data. No medical.' },
    { k: 'club_admin', l: 'Friend / Family',
      desc: 'Limited view — basic profile only. Use for support, not analysis.' }
  ];

  // Update perms whenever role changes
  useEffect(() => {
    setPerms({ ...(permTemplates[role] || {}) });
  }, [role, permTemplates]);

  // Default expiry for sports doctors/consultants (90 days)
  useEffect(() => {
    if (role === 'consultant' && !hasExpiry) {
      setHasExpiry(true);
      const d = new Date();
      d.setDate(d.getDate() + 90);
      setExpiresAt(d.toISOString().slice(0, 10));
    }
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePerm = (key) => {
    setPerms({ ...perms, [key]: !perms[key] });
  };

  const handleCreate = () => {
    onCreate({
      role,
      permissions: perms,
      invitedEmail: inviteEmail,
      invitedName: inviteName,
      personalNote: personalNote || null,
      ...(hasExpiry && expiresAt ? { expiresAt } : {})
    });
  };

  // ===== STEP: WHO =====
  if (step === 'who') {
    const canContinue = !!inviteEmail && /^.+@.+\..+/.test(inviteEmail);

    return (
      <div style={styles.athleteFrame}>
        <InviteHeaderAthlete step={1} title="Who would you like to invite?" onCancel={onCancel} />
        <div style={styles.aBody}>
          <p style={styles.aFilesIntro}>
            Invite anyone who's helping you with your training or health — a physio, a doctor, a
            coach, or anyone you choose. They'll get an email and can access your data once they
            accept.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={styles.perfFormField}>
              <div style={styles.perfFormLabel}>Their email</div>
              <input
                type="email"
                style={styles.perfInput}
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="them@example.com"
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <div style={styles.perfFormField}>
              <div style={styles.perfFormLabel}>Their name (optional)</div>
              <input
                style={styles.perfInput}
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder="Dr. Smith"
              />
            </div>
            <div style={styles.perfFormField}>
              <div style={styles.perfFormLabel}>Personal note (optional)</div>
              <textarea
                style={styles.perfTextarea}
                rows="3"
                value={personalNote}
                onChange={e => setPersonalNote(e.target.value)}
                placeholder="Hi Dr. Smith — granting you access to my training and injury history ahead of our appointment Thursday."
              />
            </div>
          </div>

          <div style={styles.inviteActions}>
            <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
            <button
              style={{ ...styles.perfSaveBtn, opacity: canContinue ? 1 : 0.4 }}
              disabled={!canContinue}
              onClick={() => setStep('role')}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== STEP: ROLE =====
  if (step === 'role') {
    return (
      <div style={styles.athleteFrame}>
        <InviteHeaderAthlete step={2} title="What's their relationship to your training?" onCancel={onCancel} />
        <div style={styles.aBody}>
          <p style={styles.aFilesIntro}>
            This sets sensible defaults for what they can see. You'll review and adjust in the next step.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {roles.map(r => (
              <button
                key={r.k}
                onClick={() => setRole(r.k)}
                style={{
                  ...styles.identityPick,
                  ...(role === r.k ? styles.identityPickActive : {})
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.identityName}>{r.l}</div>
                  <div style={styles.identityScope}>{r.desc}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={styles.inviteActions}>
            <button style={styles.perfCancelBtn} onClick={() => setStep('who')}>Back</button>
            <button style={styles.perfSaveBtn} onClick={() => setStep('perms')}>
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== STEP: PERMISSIONS =====
  if (step === 'perms') {
    // Athlete-facing labels — more conversational than the admin flow
    const permList = [
      { key: 'view_basic',    label: 'Profile (name, age, height, weight)' },
      { key: 'view_workouts', label: 'Training data (workouts, load)' },
      { key: 'view_wellness', label: 'Wellness check-ins (fatigue, sleep, mood)' },
      { key: 'view_injuries', label: 'Injury history' },
      { key: 'view_medical',  label: 'Medical details (GP, conditions, meds)', sensitive: true },
      { key: 'view_gps',      label: 'GPS / external load data' },
      { key: 'view_hr',       label: 'Heart rate data' },
      { key: 'view_notes',    label: 'Notes from other staff' },
      { key: 'view_reports',  label: 'Generated reports' },
      { key: 'edit_notes',    label: 'Can leave notes for you' },
      { key: 'edit_injuries', label: 'Can update your injury record', sensitive: true }
    ];

    return (
      <div style={styles.athleteFrame}>
        <InviteHeaderAthlete step={3} title="What can they see?" onCancel={onCancel} />
        <div style={styles.aBody}>
          <p style={styles.aFilesIntro}>
            We've pre-filled what a {ROLE_LABELS[role]?.toLowerCase()} typically needs. Toggle anything
            on or off. You can change these later.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {permList.map(p => {
              const on = !!perms[p.key];
              return (
                <button
                  key={p.key}
                  onClick={() => togglePerm(p.key)}
                  style={{
                    ...styles.invitePermRow,
                    ...(on ? styles.invitePermRowActive : {})
                  }}
                >
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    <span style={{ fontSize: 13, color: '#1a1a1a' }}>{p.label}</span>
                    {p.sensitive && (
                      <span style={styles.invitePermSensitive}>sensitive</span>
                    )}
                  </span>
                  <span style={{ ...styles.invitePermToggle, background: on ? '#1a1a1a' : '#e0d9c8' }}>
                    <span style={{
                      ...styles.invitePermToggleKnob,
                      transform: on ? 'translateX(20px)' : 'translateX(2px)'
                    }} />
                  </span>
                </button>
              );
            })}
          </div>

          {/* Expiry */}
          <div style={{ marginTop: 16, padding: '14px 16px', background: '#fdfbf5', border: '1px solid #e8e4dc', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hasExpiry ? 10 : 0 }}>
              <span style={{ flex: 1, fontSize: 13, color: '#1a1a1a' }}>Set an expiry date</span>
              <button
                onClick={() => setHasExpiry(!hasExpiry)}
                style={{ ...styles.invitePermToggle, background: hasExpiry ? '#1a1a1a' : '#e0d9c8' }}
              >
                <span style={{
                  ...styles.invitePermToggleKnob,
                  transform: hasExpiry ? 'translateX(20px)' : 'translateX(2px)'
                }} />
              </button>
            </div>
            {hasExpiry && (
              <input
                type="date"
                style={styles.perfInput}
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
              />
            )}
            {hasExpiry && (
              <p style={{ fontSize: 11, color: '#8a8275', marginTop: 8, fontStyle: 'italic' }}>
                Access will automatically end on this date. Useful for one-off consultations.
              </p>
            )}
          </div>

          <div style={styles.inviteActions}>
            <button style={styles.perfCancelBtn} onClick={() => setStep('role')}>Back</button>
            <button style={styles.perfSaveBtn} onClick={() => setStep('confirm')}>
              Review
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== STEP: CONFIRM =====
  if (step === 'confirm') {
    const grantedPerms = Object.entries(perms).filter(([, v]) => v).map(([k]) => k);

    return (
      <div style={styles.athleteFrame}>
        <InviteHeaderAthlete step={4} title="Review and send" onCancel={onCancel} />
        <div style={styles.aBody}>

          <div style={styles.inviteReviewCard}>
            <div style={styles.uploadFieldsHead}>Inviting</div>
            <div style={styles.privacyLinkName}>{inviteName || inviteEmail}</div>
            {inviteName && <div style={styles.privacyLinkMeta}>{inviteEmail}</div>}
          </div>

          <div style={styles.inviteReviewCard}>
            <div style={styles.uploadFieldsHead}>Role</div>
            <div style={styles.privacyLinkName}>
              {roles.find(r => r.k === role)?.l || ROLE_LABELS[role]}
            </div>
          </div>

          <div style={styles.inviteReviewCard}>
            <div style={styles.uploadFieldsHead}>They'll be able to see ({grantedPerms.length})</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              {grantedPerms.length === 0 ? (
                <span style={{ fontSize: 12, color: '#9c3a23' }}>Nothing selected — they won't be able to see your data.</span>
              ) : grantedPerms.map(p => (
                <span key={p} style={styles.privacyPermChip}>
                  {p.replace('view_', '').replace('edit_', '+ ').replace('_', ' ')}
                </span>
              ))}
            </div>
            {hasExpiry && expiresAt && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#5a564d' }}>
                Access expires <strong>{fmtShort(expiresAt)}</strong>
              </div>
            )}
          </div>

          {personalNote && (
            <div style={styles.inviteReviewCard}>
              <div style={styles.uploadFieldsHead}>Your note to them</div>
              <p style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.5, marginTop: 6, fontStyle: 'italic' }}>
                "{personalNote}"
              </p>
            </div>
          )}

          <p style={{ fontSize: 11, color: '#8a8275', lineHeight: 1.5, fontStyle: 'italic', marginTop: 12 }}>
            They'll receive an email with a link to view your data. You can revoke access at any time
            from this Privacy & access screen.
          </p>

          <div style={styles.inviteActions}>
            <button style={styles.perfCancelBtn} onClick={() => setStep('perms')}>Back</button>
            <button style={styles.perfSaveBtn} onClick={handleCreate}>
              Send invitation
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function InviteHeaderAthlete({ step, title, onCancel }) {
  return (
    <div style={styles.subHeader}>
      <button onClick={onCancel} style={styles.backBtn} aria-label="Cancel">
        <X size={18} strokeWidth={2} />
      </button>
      <div>
        <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
                     color: '#c8472b', fontWeight: 600, marginBottom: 2 }}>
          Step {step} of 4
        </div>
        <span style={styles.subHeaderTitle}>{title}</span>
      </div>
      <div style={{ width: 30 }} />
    </div>
  );
}


// ============================================================
// TeamAccessScreen — admin view of users + invite flow
// ============================================================
function TeamAccessScreen({ athletes, links, currentUser, onCreateLinks, onRevokeLink, onBack }) {
  const [users, setUsers] = useState([]);
  const [permTemplates, setPermTemplates] = useState({});
  const [showInvite, setShowInvite] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [filter, setFilter] = useState('all'); // all | active | pending

  useEffect(() => {
    const seed = getSeedData();
    setUsers(seed.teamUsers || []);
    setPermTemplates(seed.PERM_TEMPLATES || {});
  }, []);

  // Group links by user
  const linksByUser = {};
  links.forEach(l => {
    if (l.status === 'revoked') return;
    if (l.role === 'self') return;
    const key = l.userId || `pending:${l.invitedEmail}`;
    if (!linksByUser[key]) linksByUser[key] = [];
    linksByUser[key].push(l);
  });

  const userRows = Object.entries(linksByUser).map(([key, userLinks]) => {
    const isPending = key.startsWith('pending:');
    if (isPending) {
      const sample = userLinks[0];
      return {
        key, isPending: true,
        name: sample.invitedName || sample.invitedEmail,
        email: sample.invitedEmail,
        role: sample.role,
        avatar: (sample.invitedName || sample.invitedEmail || '?').slice(0, 2).toUpperCase(),
        links: userLinks
      };
    }
    const u = users.find(x => x.id === key);
    if (!u) return null;
    return {
      key, isPending: false,
      name: u.name, email: u.email, role: u.role,
      title: u.title, avatar: u.avatar,
      links: userLinks
    };
  }).filter(Boolean);

  const filtered = userRows.filter(r => {
    if (filter === 'active') return !r.isPending;
    if (filter === 'pending') return r.isPending;
    return true;
  });

  if (showInvite) {
    return (
      <InviteFlow
        athletes={athletes}
        users={users}
        permTemplates={permTemplates}
        existingLinks={links}
        onCreate={(payload) => {
          onCreateLinks(payload);
          setShowInvite(false);
        }}
        onCancel={() => setShowInvite(false)}
      />
    );
  }

  return (
    <div style={styles.pFrame}>
      <header style={styles.pHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onBack} style={styles.pBackBtn}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={styles.pHeaderKicker}>Team & access</div>
            <div style={styles.pOrgName}>Manage staff links</div>
          </div>
        </div>
      </header>

      <div style={styles.teamAccessIntro}>
        <p style={styles.aFilesIntro}>
          You're the club administrator. Here you can see everyone with access to the squad's data
          and invite new staff. Each athlete still controls who can see their record on the athlete app.
        </p>
      </div>

      <div style={styles.teamAccessActionBar}>
        <button style={styles.perfActionPrimary} onClick={() => setShowInvite(true)}>
          + Invite staff member
        </button>
      </div>

      <div className="tempo-scroll-x" style={styles.pFilters}>
        <span style={styles.pFilterLabel}>Show</span>
        {[
          { k: 'all', l: `All (${userRows.length})` },
          { k: 'active', l: `Active (${userRows.filter(r => !r.isPending).length})` },
          { k: 'pending', l: `Pending (${userRows.filter(r => r.isPending).length})` }
        ].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            style={{ ...styles.pFilterBtn, ...(filter === f.k ? styles.pFilterBtnActive : {}) }}>
            {f.l}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length === 0 ? (
          <div style={styles.perfEmpty}>No staff match this filter.</div>
        ) : (
          filtered.map(row => (
            <div key={row.key} style={styles.teamAccessUserCard}>
              <div style={styles.teamAccessUserHead}>
                <div style={styles.privacyLinkAvatar}>{row.avatar}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.privacyLinkName}>{row.name}</div>
                  <div style={styles.privacyLinkRole}>
                    {ROLE_LABELS[row.role] || row.role}
                    {row.title && ` · ${row.title}`}
                  </div>
                  <div style={styles.privacyLinkMeta}>{row.email}</div>
                </div>
                {row.isPending && (
                  <span style={styles.teamAccessPendingBadge}>Pending</span>
                )}
              </div>

              <div style={styles.teamAccessAthleteList}>
                <div style={styles.teamAccessAthleteListLabel}>
                  Access to {row.links.length} {row.links.length === 1 ? 'athlete' : 'athletes'}
                </div>
                <div style={styles.teamAccessAthleteChips}>
                  {row.links.slice(0, 8).map(l => {
                    const a = athletes.find(x => x.id === l.athleteId);
                    return (
                      <span key={l.id} style={styles.teamAccessAthleteChip}>
                        {a?.name || l.athleteId}
                      </span>
                    );
                  })}
                  {row.links.length > 8 && (
                    <span style={styles.teamAccessAthleteChip}>
                      +{row.links.length - 8} more
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setConfirmRevoke(row)}
                style={styles.privacyRevokeBtn}
              >
                Revoke all access
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ height: 24 }} />

      {/* Revoke confirmation */}
      {confirmRevoke && (
        <div
          style={styles.userSheetBackdrop}
          onClick={() => setConfirmRevoke(null)}
        >
          <div style={styles.userSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.userSheetGrip} />
            <div style={{ padding: '4px 20px 20px' }}>
              <div style={styles.userSheetName}>Revoke {confirmRevoke.name}?</div>
              <p style={{ fontSize: 13, color: '#5a564d', lineHeight: 1.5, marginTop: 10 }}>
                This will remove access to all {confirmRevoke.links.length} athlete{confirmRevoke.links.length === 1 ? '' : 's'}. They'll need to be re-invited to regain access.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button
                  style={{ ...styles.perfCancelBtn, flex: 1 }}
                  onClick={() => setConfirmRevoke(null)}
                >
                  Cancel
                </button>
                <button
                  style={{ ...styles.perfSaveBtn, flex: 1, background: '#9c3a23' }}
                  onClick={() => {
                    confirmRevoke.links.forEach(l => onRevokeLink(l.id));
                    setConfirmRevoke(null);
                  }}
                >
                  Revoke
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// InviteFlow — invite an existing user or new email to athletes
// ============================================================
function InviteFlow({ athletes, users, permTemplates, existingLinks, onCreate, onCancel }) {
  // Two modes: pick existing user OR invite new email
  const [step, setStep] = useState('who'); // who | role | athletes | perms | confirm
  const [inviteMode, setInviteMode] = useState('existing'); // existing | new
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [role, setRole] = useState('sc_coach');
  const [selectedAthleteIds, setSelectedAthleteIds] = useState([]);
  const [perms, setPerms] = useState({});
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');

  // Update perms whenever role changes
  useEffect(() => {
    setPerms({ ...(permTemplates[role] || {}) });
  }, [role, permTemplates]);

  // Set default expiry for consultants
  useEffect(() => {
    if (role === 'consultant' && !hasExpiry) {
      setHasExpiry(true);
      const d = new Date();
      d.setDate(d.getDate() + 90);
      setExpiresAt(d.toISOString().slice(0, 10));
    }
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedUser = users.find(u => u.id === selectedUserId);
  const staffUsers = users.filter(u => u.isStaff);

  // For "existing user" mode: which athletes do they already have access to?
  const existingAthleteIds = new Set(
    existingLinks
      .filter(l => l.userId === selectedUserId && l.status !== 'revoked' && l.role !== 'self')
      .map(l => l.athleteId)
  );

  const toggleAthlete = (id) => {
    if (selectedAthleteIds.includes(id)) {
      setSelectedAthleteIds(selectedAthleteIds.filter(x => x !== id));
    } else {
      setSelectedAthleteIds([...selectedAthleteIds, id]);
    }
  };

  const togglePerm = (key) => {
    setPerms({ ...perms, [key]: !perms[key] });
  };

  const handleCreate = () => {
    const payload = {
      role,
      permissions: perms,
      athleteIds: selectedAthleteIds,
      ...(hasExpiry && expiresAt ? { expiresAt } : {})
    };
    if (inviteMode === 'existing' && selectedUserId) {
      payload.userId = selectedUserId;
    } else if (inviteMode === 'new') {
      payload.invitedEmail = inviteEmail;
      payload.invitedName = inviteName;
    }
    onCreate(payload);
  };

  // ===== STEP: WHO =====
  if (step === 'who') {
    const canContinue = inviteMode === 'existing'
      ? !!selectedUserId
      : (!!inviteEmail && /^.+@.+\..+/.test(inviteEmail));

    return (
      <div style={styles.pFrame}>
        <InviteHeader
          step={1}
          title="Who are you inviting?"
          onCancel={onCancel}
        />

        <div style={styles.inviteSegment}>
          <button
            style={{ ...styles.inviteSegmentBtn, ...(inviteMode === 'existing' ? styles.inviteSegmentBtnActive : {}) }}
            onClick={() => setInviteMode('existing')}
          >
            Existing staff
          </button>
          <button
            style={{ ...styles.inviteSegmentBtn, ...(inviteMode === 'new' ? styles.inviteSegmentBtnActive : {}) }}
            onClick={() => setInviteMode('new')}
          >
            New email
          </button>
        </div>

        {inviteMode === 'existing' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {staffUsers.map(u => (
              <button
                key={u.id}
                onClick={() => setSelectedUserId(u.id)}
                style={{
                  ...styles.identityPick,
                  ...(selectedUserId === u.id ? styles.identityPickActive : {})
                }}
              >
                <div style={styles.identityAvatar}>{u.avatar}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.identityName}>{u.name}</div>
                  <div style={styles.identityMeta}>
                    {u.title || ROLE_LABELS[u.role]}
                  </div>
                  <div style={styles.identityScope}>{u.email}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={styles.perfFormField}>
              <div style={styles.perfFormLabel}>Email</div>
              <input
                type="email"
                style={styles.perfInput}
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="staff@example.com"
              />
            </div>
            <div style={styles.perfFormField}>
              <div style={styles.perfFormLabel}>Name (optional)</div>
              <input
                style={styles.perfInput}
                value={inviteName}
                onChange={e => setInviteName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <p style={{ fontSize: 11, color: '#8a8275', fontStyle: 'italic', lineHeight: 1.5 }}>
              They'll receive an email invitation. The link becomes active when they sign up
              and the affected athletes have accepted on their privacy screen.
            </p>
          </div>
        )}

        <div style={styles.inviteActions}>
          <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...styles.perfSaveBtn, opacity: canContinue ? 1 : 0.4 }}
            disabled={!canContinue}
            onClick={() => setStep('role')}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ===== STEP: ROLE =====
  if (step === 'role') {
    const roles = [
      { k: 'head_coach', l: 'Head Coach', desc: 'Full training data, no medical detail.' },
      { k: 'sc_coach',   l: 'S&C Coach',  desc: 'Full training, can edit workouts.' },
      { k: 'physio',     l: 'Physio',     desc: 'Medical, injuries, no GPS.' },
      { k: 'consultant', l: 'Consultant', desc: 'Read access, time-limited.' },
      { k: 'club_admin', l: 'Club Admin', desc: 'Roster management only.' }
    ];

    return (
      <div style={styles.pFrame}>
        <InviteHeader
          step={2}
          title="Pick a role"
          onCancel={onCancel}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {roles.map(r => (
            <button
              key={r.k}
              onClick={() => setRole(r.k)}
              style={{
                ...styles.identityPick,
                ...(role === r.k ? styles.identityPickActive : {})
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.identityName}>{r.l}</div>
                <div style={styles.identityScope}>{r.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div style={styles.inviteActions}>
          <button style={styles.perfCancelBtn} onClick={() => setStep('who')}>Back</button>
          <button style={styles.perfSaveBtn} onClick={() => setStep('athletes')}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ===== STEP: ATHLETES =====
  if (step === 'athletes') {
    const eligibleAthletes = athletes.filter(a => !existingAthleteIds.has(a.id));
    const allSelected = selectedAthleteIds.length === eligibleAthletes.length && eligibleAthletes.length > 0;

    return (
      <div style={styles.pFrame}>
        <InviteHeader
          step={3}
          title="Which athletes?"
          onCancel={onCancel}
        />

        {eligibleAthletes.length === 0 ? (
          <div style={styles.perfEmpty}>
            {selectedUser?.name || 'This user'} already has access to every athlete.
          </div>
        ) : (
          <>
            <button
              style={styles.inviteBulkBtn}
              onClick={() => {
                if (allSelected) setSelectedAthleteIds([]);
                else setSelectedAthleteIds(eligibleAthletes.map(a => a.id));
              }}
            >
              {allSelected ? 'Clear all' : 'Select all'} ({eligibleAthletes.length})
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {eligibleAthletes.map(a => {
                const selected = selectedAthleteIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => toggleAthlete(a.id)}
                    style={{
                      ...styles.inviteAthleteRow,
                      ...(selected ? styles.inviteAthleteRowActive : {})
                    }}
                  >
                    <span style={{ ...styles.inviteCheckbox, ...(selected ? styles.inviteCheckboxActive : {}) }}>
                      {selected ? '✓' : ''}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.perfRowName}>{a.name}</div>
                      <div style={styles.perfRowMeta}>
                        {a.position} · {a.playerId}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {existingAthleteIds.size > 0 && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: '#f5f1e8', borderRadius: 8 }}>
                <div style={styles.uploadFieldsHead}>Already has access to</div>
                <div style={{ fontSize: 11, color: '#5a564d', marginTop: 4 }}>
                  {[...existingAthleteIds].map(id => athletes.find(a => a.id === id)?.name).filter(Boolean).join(', ')}
                </div>
              </div>
            )}
          </>
        )}

        <div style={styles.inviteActions}>
          <button style={styles.perfCancelBtn} onClick={() => setStep('role')}>Back</button>
          <button
            style={{ ...styles.perfSaveBtn, opacity: selectedAthleteIds.length > 0 ? 1 : 0.4 }}
            disabled={selectedAthleteIds.length === 0}
            onClick={() => setStep('perms')}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ===== STEP: PERMISSIONS =====
  if (step === 'perms') {
    const permList = [
      { key: 'view_basic',    label: 'Profile' },
      { key: 'view_workouts', label: 'Training data' },
      { key: 'view_wellness', label: 'Wellness' },
      { key: 'view_injuries', label: 'Injury record' },
      { key: 'view_medical',  label: 'Medical (clinical detail)', sensitive: true },
      { key: 'view_gps',      label: 'GPS / external load' },
      { key: 'view_hr',       label: 'Heart rate' },
      { key: 'view_notes',    label: 'Notes' },
      { key: 'view_reports',  label: 'Reports' },
      { key: 'view_export',   label: 'Export data', sensitive: true },
      { key: 'edit_workouts', label: 'Edit workouts' },
      { key: 'edit_injuries', label: 'Edit injuries' },
      { key: 'edit_notes',    label: 'Edit notes' }
    ];

    return (
      <div style={styles.pFrame}>
        <InviteHeader
          step={4}
          title="Permissions"
          onCancel={onCancel}
        />

        <p style={styles.aFilesIntro}>
          Pre-filled from the {ROLE_LABELS[role]} template. Toggle any to customise.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {permList.map(p => {
            const on = !!perms[p.key];
            return (
              <button
                key={p.key}
                onClick={() => togglePerm(p.key)}
                style={{
                  ...styles.invitePermRow,
                  ...(on ? styles.invitePermRowActive : {})
                }}
              >
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <span style={{ fontSize: 13, color: '#1a1a1a' }}>{p.label}</span>
                  {p.sensitive && (
                    <span style={styles.invitePermSensitive}>sensitive</span>
                  )}
                </span>
                <span style={{ ...styles.invitePermToggle, background: on ? '#1a1a1a' : '#e0d9c8' }}>
                  <span style={{
                    ...styles.invitePermToggleKnob,
                    transform: on ? 'translateX(20px)' : 'translateX(2px)'
                  }} />
                </span>
              </button>
            );
          })}
        </div>

        {/* Expiry */}
        <div style={{ marginTop: 16, padding: '14px 16px', background: '#fdfbf5', border: '1px solid #e8e4dc', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hasExpiry ? 10 : 0 }}>
            <span style={{ flex: 1, fontSize: 13, color: '#1a1a1a' }}>Set an expiry date</span>
            <button
              onClick={() => setHasExpiry(!hasExpiry)}
              style={{ ...styles.invitePermToggle, background: hasExpiry ? '#1a1a1a' : '#e0d9c8' }}
            >
              <span style={{
                ...styles.invitePermToggleKnob,
                transform: hasExpiry ? 'translateX(20px)' : 'translateX(2px)'
              }} />
            </button>
          </div>
          {hasExpiry && (
            <input
              type="date"
              style={styles.perfInput}
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
            />
          )}
        </div>

        <div style={styles.inviteActions}>
          <button style={styles.perfCancelBtn} onClick={() => setStep('athletes')}>Back</button>
          <button style={styles.perfSaveBtn} onClick={() => setStep('confirm')}>
            Review
          </button>
        </div>
      </div>
    );
  }

  // ===== STEP: CONFIRM =====
  if (step === 'confirm') {
    const grantedPerms = Object.entries(perms).filter(([, v]) => v).map(([k]) => k);
    const targetName = inviteMode === 'existing'
      ? selectedUser?.name
      : (inviteName || inviteEmail);

    return (
      <div style={styles.pFrame}>
        <InviteHeader
          step={5}
          title="Review and send"
          onCancel={onCancel}
        />

        <div style={styles.inviteReviewCard}>
          <div style={styles.uploadFieldsHead}>Inviting</div>
          <div style={styles.privacyLinkName}>{targetName}</div>
          {inviteMode === 'existing'
            ? <div style={styles.privacyLinkMeta}>{selectedUser?.email}</div>
            : <div style={styles.privacyLinkMeta}>{inviteEmail}</div>
          }
        </div>

        <div style={styles.inviteReviewCard}>
          <div style={styles.uploadFieldsHead}>Role</div>
          <div style={styles.privacyLinkName}>{ROLE_LABELS[role]}</div>
        </div>

        <div style={styles.inviteReviewCard}>
          <div style={styles.uploadFieldsHead}>
            Athletes ({selectedAthleteIds.length})
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {selectedAthleteIds.map(id => {
              const a = athletes.find(x => x.id === id);
              return (
                <span key={id} style={styles.teamAccessAthleteChip}>
                  {a?.name || id}
                </span>
              );
            })}
          </div>
        </div>

        <div style={styles.inviteReviewCard}>
          <div style={styles.uploadFieldsHead}>Permissions ({grantedPerms.length})</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {grantedPerms.map(p => (
              <span key={p} style={styles.privacyPermChip}>
                {p.replace('view_', '').replace('edit_', '+ ').replace('_', ' ')}
              </span>
            ))}
          </div>
          {hasExpiry && expiresAt && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#5a564d', fontStyle: 'italic' }}>
              Expires {fmtShort(expiresAt)}
            </div>
          )}
        </div>

        <div style={styles.inviteActions}>
          <button style={styles.perfCancelBtn} onClick={() => setStep('perms')}>Back</button>
          <button style={styles.perfSaveBtn} onClick={handleCreate}>
            {inviteMode === 'existing'
              ? `Grant access to ${selectedAthleteIds.length} ${selectedAthleteIds.length === 1 ? 'athlete' : 'athletes'}`
              : 'Send invitation'}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function InviteHeader({ step, title, onCancel }) {
  return (
    <header style={styles.pHeader}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onCancel} style={styles.pBackBtn}>
          <X size={16} />
        </button>
        <div>
          <div style={styles.pHeaderKicker}>Step {step} of 5</div>
          <div style={styles.pOrgName}>{title}</div>
        </div>
      </div>
    </header>
  );
}


function SubHeader({ title, onBack }) {
  return (
    <div style={styles.subHeader}>
      <button onClick={onBack} style={styles.backBtn}>
        <ArrowLeft size={18} strokeWidth={2} />
      </button>
      <span style={styles.subHeaderTitle}>{title}</span>
      <div style={{ width: 30 }} />
    </div>
  );
}

function Label({ children }) {
  return <div style={styles.fieldLabel}>{children}</div>;
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={styles.toast}>
      <Check size={14} /> {msg}
    </div>
  );
}

// ============================================================
// PRACTITIONER DASHBOARD
// ============================================================
function PractitionerApp({ currentUser, auditLog, recordAudit, onSwitchView, onOpenSwitcher, onLogout }) {
  const [athletes, setAthletes] = useState([]);
  const [workouts, setWorkouts] = useState([]);
  const [checkins, setCheckins] = useState([]);
  const [notes, setNotes] = useState([]);
  const [injuries, setInjuries] = useState([]);
  const [tests, setTests] = useState([]);
  const [concussionBaselines, setConcussionBaselines] = useState([]);
  const [concussionIncidents, setConcussionIncidents] = useState([]);
  const [files, setFiles] = useState([]);
  const [links, setLinks] = useState([]);
  const [selectedAthlete, setSelectedAthlete] = useState(null);
  const [filter, setFilter] = useState('all'); // all | flagged | injured | missing
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('roster'); // roster | performance
  const [showTeamAccess, setShowTeamAccess] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const seed = getSeedData();
    setAthletes(seed.teamAthletes);
    setWorkouts(seed.teamWorkouts);
    setCheckins(seed.teamWellness);
    setNotes(seed.teamNotes);
    setInjuries(seed.teamInjuries || []);
    setTests(seed.teamTests || []);
    setConcussionBaselines(seed.teamConcussionBaselines || []);
    setConcussionIncidents(seed.teamConcussionIncidents || []);
    setFiles(seed.teamFiles || []);
    setLinks(seed.teamAthleteLinks || []);
    setLoading(false);
  }, []);

  // Filter athletes to only those the current user can access
  const accessibleIds = accessibleAthleteIds(currentUser, links);
  // When viewing as practitioner, exclude the user's own athlete profile from the caseload —
  // it appears under "My training" instead (the dual-mode switcher).
  const visibleAthletes = athletes
    .filter(a => accessibleIds.includes(a.id))
    .filter(a => a.id !== currentUser?.athleteId);

  // Group accessible athletes by club for the header summary.
  // If the user is at one club, show the club name.
  // If they span multiple, show "Caseload · 3 clubs + privates" etc.
  const clubsRepresented = [...new Set(visibleAthletes.map(a => a.team).filter(Boolean))];
  const squadsRepresented = [...new Set(visibleAthletes.filter(a => a.team && a.squad).map(a => `${a.team}::${a.squad}`))];
  const independentCount = visibleAthletes.filter(a => !a.team).length;
  const totalContexts = clubsRepresented.length + (independentCount > 0 ? 1 : 0);
  let headerTitle, headerSub;
  if (totalContexts === 0) {
    headerTitle = 'Caseload';
    headerSub = 'No athletes yet · Invite to begin';
  } else if (clubsRepresented.length === 1 && independentCount === 0) {
    // Single-club case (e.g. club admin, head coach at one club)
    headerTitle = clubsRepresented[0];
    // Show squad count if the club has multiple squads
    const squadsAtClub = squadsRepresented.filter(s => s.startsWith(clubsRepresented[0] + '::'));
    if (squadsAtClub.length > 1) {
      headerSub = `${squadsAtClub.length} squads · ${visibleAthletes.length} athletes`;
    } else {
      headerSub = `${visibleAthletes.length} athletes`;
    }
  } else if (clubsRepresented.length === 0 && independentCount > 0) {
    // Private practice only
    headerTitle = 'Caseload';
    headerSub = `${independentCount} private ${independentCount === 1 ? 'client' : 'clients'}`;
  } else {
    // Mixed — multi-club / private clients
    const parts = [];
    if (clubsRepresented.length > 0) parts.push(`${clubsRepresented.length} ${clubsRepresented.length === 1 ? 'club' : 'clubs'}`);
    if (independentCount > 0) parts.push(`${independentCount} private`);
    headerTitle = 'Caseload';
    headerSub = `${parts.join(' · ')} · ${visibleAthletes.length} athletes`;
  }

  // Sync athletes' injuryStatus from the live injuries dataset
  // (so injuries entered via the form drive the traffic-light dot)
  const athletesWithStatus = visibleAthletes.map(a => {
    const openInj = injuries
      .filter(i => i.athleteId === a.id && i.status !== 'returned')
      .sort((x, y) => y.reportedOn.localeCompare(x.reportedOn))[0];
    if (openInj) {
      return {
        ...a,
        injuryStatus: openInj.status,
        injuryNote: `${openInj.side ? openInj.side + ' ' : ''}${openInj.bodyRegion.toLowerCase()} · ${openInj.injuryType.split(' ')[0].toLowerCase()}`
      };
    }
    return { ...a, injuryStatus: 'available', injuryNote: null };
  });

  // Mutations — used by data entry forms in child views
  const addInjury = (inj) => {
    const newInj = { ...inj, id: `inj_${Date.now()}`, reportedOn: today() };
    setInjuries([newInj, ...injuries]);
    // If this injury is a concussion, also create a concussion incident automatically.
    // The two records are linked via linkedInjuryId so we can keep them in sync.
    const isConcussion = (
      /concussion/i.test(inj.injuryType || '') ||
      /concussion|head|brain/i.test(inj.diagnosis || '') ||
      /head|skull/i.test(inj.bodyRegion || '')
    );
    if (isConcussion) {
      const newCi = {
        id: `ci_${Date.now()}_auto`,
        athleteId: inj.athleteId,
        date: inj.occurredOn || today(),
        mechanism: inj.mechanism || 'Reported via injury log',
        description: inj.activityContext || inj.athleteDescription || 'Auto-linked from injury record',
        sport: inj.activity || null,
        linkedInjuryId: newInj.id,
        autoCreated: true,
        reportedBy: inj.reportedBy || 'Auto-linked',
        symptoms: inj.whatYouFelt || null,
        // RTP follows the linked injury — these stay editable separately if needed
        rtpStatus: 'stage_1',
        notes: 'Auto-created from injury record. Update with SCAT details and assessment.'
      };
      setConcussionIncidents(prev => [newCi, ...prev]);
    }
  };

  const updateInjury = (id, patch) => {
    setInjuries(injuries.map(i => i.id === id ? { ...i, ...patch } : i));
  };

  const addTest = (t) => {
    const newTest = { ...t, id: `t_${Date.now()}` };
    setTests([newTest, ...tests]);
  };

  const addBaseline = (b) => {
    const newB = { ...b, id: `cb_${Date.now()}` };
    // Replace any existing baseline for same athlete (latest wins)
    setConcussionBaselines([newB, ...concussionBaselines.filter(x => x.athleteId !== b.athleteId)]);
  };

  const addConcussionIncident = (ci) => {
    const newCi = { ...ci, id: `ci_${Date.now()}` };
    setConcussionIncidents([newCi, ...concussionIncidents]);
  };

  const addFile = (f) => {
    const newF = { ...f, id: `f_${Date.now()}`, date: today() };
    setFiles([newF, ...files]);
  };

  const addNote = (n) => {
    const newN = {
      ...n,
      id: `n_${Date.now()}`,
      date: today(),
      author: currentUser?.name || 'Unknown',
      role: currentUser?.title || ROLE_LABELS[currentUser?.role] || 'Staff'
    };
    setNotes([newN, ...notes]);
  };

  // Create one or more athlete links (invite flow)
  // invite: { userId?, invitedEmail?, invitedName?, role, permissions, athleteIds: string[], expiresAt? }
  const createLinks = (invite) => {
    const now = today();
    const newLinks = invite.athleteIds.map(athleteId => ({
      id: `lnk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${athleteId}`,
      athleteId,
      userId: invite.userId || null,
      invitedEmail: invite.invitedEmail || null,
      invitedName: invite.invitedName || null,
      role: invite.role,
      permissions: { ...invite.permissions },
      status: invite.userId ? 'active' : 'pending',
      acceptedAt: invite.userId ? now : null,
      expiresAt: invite.expiresAt || null,
      revokedAt: null,
      createdAt: now
    }));
    setLinks([...links, ...newLinks]);
    return newLinks;
  };

  // Revoke a specific link
  const revokeLink = (linkId) => {
    setLinks(links.map(l =>
      l.id === linkId
        ? { ...l, status: 'revoked', revokedAt: new Date().toISOString() }
        : l
    ));
  };

  // Merge GPS / fitness data uploaded as multiple rows
  // Each row already has an athleteId (resolved) and a date
  const mergeUploadedSessions = (rows, opts) => {
    const choice = opts?.overwriteChoice || 'replace';
    let updated = [...workouts];
    let added = 0, replaced = 0, merged = 0, skipped = 0;

    rows.forEach(row => {
      const existingIdx = updated.findIndex(w =>
        w.athleteId === row.athleteId && w.date === row.date
      );
      if (existingIdx >= 0) {
        if (choice === 'skip') { skipped++; return; }
        if (choice === 'replace') {
          // Replace but keep id and any locally-set rpe/note
          const existing = updated[existingIdx];
          updated[existingIdx] = {
            ...existing,
            ...row,
            id: existing.id,
            rpe: row.rpe !== undefined ? row.rpe : existing.rpe,
            note: existing.note
          };
          replaced++;
        } else if (choice === 'merge') {
          // Fill empty fields only
          const existing = updated[existingIdx];
          const m = { ...existing };
          Object.entries(row).forEach(([k, v]) => {
            if ((m[k] === undefined || m[k] === null || m[k] === '') && v !== undefined && v !== null) {
              m[k] = v;
            }
          });
          updated[existingIdx] = m;
          merged++;
        }
      } else {
        updated.push({
          ...row,
          id: `w_imp_${row.athleteId}_${row.date}_${Date.now()}_${added}`,
          source: 'csv_upload',
          duration: row.durationMin || 60,
          rpe: row.rpe || null,
          type: row.sessionType || 'GPS session',
          note: ''
        });
        added++;
      }
    });

    setWorkouts(updated);
    return { added, replaced, merged, skipped };
  };

  if (loading) {
    return <div style={styles.pFrame}><div style={{ padding: 60, color: '#8a8275' }}>Loading roster…</div></div>;
  }

  // Per-athlete computed metrics
  const rows = athletesWithStatus.map(a => {
    const aw = workouts.filter(w => w.athleteId === a.id);
    const ac = checkins.filter(c => c.athleteId === a.id);
    const weekly = calc.weeklyLoad(aw, today());
    const acwr = calc.acwr(aw, today());
    const mon = calc.monotony(aw, today());
    const wellAvg = calc.wellnessAvg(ac, 7, today());
    const lastSession = aw.length ? aw.sort((x, y) => y.date.localeCompare(x.date))[0] : null;
    const dayssince = lastSession ? Math.floor((new Date(today()) - new Date(lastSession.date)) / 86400000) : null;

    // Status
    const flags = [];
    if (acwr && acwr > 1.5) flags.push({ type: 'load', label: 'Load spike' });
    if (mon && mon > 2 && weekly.total > 200) flags.push({ type: 'monotony', label: 'Low variation' });
    // Wellness-related flags only meaningful if the athlete is doing check-ins
    const wellnessFreq = a.wellnessSettings?.frequency || 'daily';
    if (wellAvg && wellAvg > 4 && wellnessFreq !== 'off') flags.push({ type: 'wellness', label: 'Wellness ↓' });
    if (dayssince !== null && dayssince > 4) flags.push({ type: 'missing', label: 'Missing data' });
    // Compliance flag: scale expectation to chosen frequency.
    // 'off' is never low-compliance (opted out is a choice, not a problem).
    const minExpected = wellnessFreq === 'off' ? 0
                      : wellnessFreq === 'weekly' ? 1
                      : wellnessFreq === 'three_per_week' ? 2
                      : 3; // daily
    if (minExpected > 0 && ac.length < minExpected) flags.push({ type: 'compliance', label: 'Low compliance' });

    let status = 'Stable';
    if (flags.some(f => f.type === 'load' || f.type === 'wellness')) status = 'Review';
    else if (flags.length > 0) status = 'Monitor';
    if (flags.some(f => f.type === 'missing') && flags.length === 1) status = 'Missing Data';

    return { athlete: a, weekly, acwr, mon, wellAvg, lastSession, dayssince, flags, status, workouts: aw, checkins: ac };
  });

  // Filter
  const normalisedQuery = searchQuery.trim().toLowerCase();
  const visibleRows = rows.filter(r => {
    // Search by name, position, player ID, team, squad
    if (normalisedQuery) {
      const haystack = [
        r.athlete.name,
        r.athlete.position,
        r.athlete.playerId,
        r.athlete.team,
        r.athlete.squad
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(normalisedQuery)) return false;
    }
    if (filter === 'flagged') return r.flags.length > 0;
    if (filter === 'missing') return r.flags.some(f => f.type === 'missing' || f.type === 'compliance');
    if (filter === 'injured') return (r.athlete.injuryStatus || 'available') !== 'available';
    return true;
  });

  // Org summary
  const totalAthletes = rows.length;
  const flaggedCount = rows.filter(r => r.flags.length > 0).length;

  // Wellness compliance respects each athlete's chosen frequency.
  // Athletes opted out ('off') are excluded entirely so they don't drag the % down.
  // Reduced-frequency athletes have a lower expected count.
  const wellnessParticipating = rows.filter(r =>
    (r.athlete.wellnessSettings?.frequency || 'daily') !== 'off'
  );
  const wellnessCompletion = wellnessParticipating.length === 0 ? 100 : Math.round(
    (wellnessParticipating.reduce((s, r) => {
      const freq = r.athlete.wellnessSettings?.frequency || 'daily';
      const expectedPerWeek = freq === 'three_per_week' ? 3 : freq === 'weekly' ? 1 : 7;
      const actual = r.checkins.filter(c => {
        const cd = new Date(c.date), end = new Date(today()), cutoff = new Date(end);
        cutoff.setDate(end.getDate() - 6);
        return cd >= cutoff && cd <= end;
      }).length;
      return s + Math.min(actual / expectedPerWeek, 1);
    }, 0) / wellnessParticipating.length) * 100
  );
  const wellnessOffCount = totalAthletes - wellnessParticipating.length;
  const teamLoad = Math.round(rows.reduce((s, r) => s + r.weekly.total, 0) / Math.max(rows.length, 1));

  // Mutation handlers passed to athlete detail (for entering data in-context)
  const perfData = {
    injuries, tests, concussionBaselines, concussionIncidents, files, workouts,
    addInjury, updateInjury, addTest, addBaseline, addConcussionIncident, addFile,
    mergeUploadedSessions
  };

  if (showPrivacy) {
    return (
      <StaffPrivacy
        currentUser={currentUser}
        onBack={() => setShowPrivacy(false)}
      />
    );
  }

  if (showTeamAccess) {
    return (
      <TeamAccessScreen
        athletes={athletes}
        links={links}
        currentUser={currentUser}
        onCreateLinks={createLinks}
        onRevokeLink={revokeLink}
        onBack={() => setShowTeamAccess(false)}
      />
    );
  }

  if (selectedAthlete) {
    const row = rows.find(r => r.athlete.id === selectedAthlete);
    if (row) return (
      <AthleteDetail
        row={row}
        notes={notes.filter(n => n.athleteId === selectedAthlete)}
        onAddNote={(noteData) => addNote({ ...noteData, athleteId: selectedAthlete })}
        perfData={perfData}
        currentUser={currentUser}
        links={links}
        recordAudit={recordAudit}
        onBack={() => setSelectedAthlete(null)}
      />
    );
  }

  return (
    <div style={styles.pFrame}>
      {/* Header */}
      <header style={styles.pHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...styles.brandMark, fontSize: 22 }}>◐</span>
            <span style={{ ...styles.brandWord, fontSize: 18 }}>tempo</span>
          </div>
          <span style={styles.pHeaderDivider}>/</span>
          <div>
            <div style={styles.pOrgName}>{headerTitle}</div>
            <div style={styles.pOrgSub}>{headerSub}</div>
          </div>
        </div>
        <UserBadge
          user={currentUser}
          onSwitch={onOpenSwitcher}
          onLogout={onLogout}
          onPrivacy={() => setShowPrivacy(true)}
          onInvite={
            currentUser?.role === 'club_admin'
              ? () => setShowTeamAccess(true)
              : null
          }
        />
      </header>

      {/* Dual-identity mode switcher — shown when the user has BOTH staff and athlete identities */}
      {currentUser?.athleteId && (
        <div style={styles.dualModeSwitcher}>
          <button style={{ ...styles.dualModeBtn, ...styles.dualModeBtnActive }}>
            <span style={styles.dualModeBtnIcon}>◐</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={styles.dualModeBtnLabel}>Practitioner</div>
              <div style={styles.dualModeBtnSub}>{currentUser.title || ROLE_LABELS[currentUser.role]}</div>
            </div>
          </button>
          <button onClick={onSwitchView} style={styles.dualModeBtn}>
            <span style={{ ...styles.dualModeBtnIcon, opacity: 0.5 }}>○</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={styles.dualModeBtnLabel}>My training</div>
              <div style={styles.dualModeBtnSub}>Athlete view</div>
            </div>
          </button>
        </div>
      )}

      {/* View mode tabs */}
      <div className="tempo-scroll-x" style={styles.pViewTabs}>
        <button
          onClick={() => setViewMode('roster')}
          style={{ ...styles.pViewTab, ...(viewMode === 'roster' ? styles.pViewTabActive : {}) }}
        >
          Roster
        </button>
        <button
          onClick={() => setViewMode('performance')}
          style={{ ...styles.pViewTab, ...(viewMode === 'performance' ? styles.pViewTabActive : {}) }}
        >
          Performance
        </button>
        <button
          onClick={() => setViewMode('contacts')}
          style={{ ...styles.pViewTab, ...(viewMode === 'contacts' ? styles.pViewTabActive : {}) }}
        >
          Contacts
        </button>
      </div>

      {viewMode === 'contacts' ? (
        <ContactsTeamView
          athletes={athletesWithStatus}
          currentUser={currentUser}
          links={links}
          onPickAthlete={setSelectedAthlete}
        />
      ) : viewMode === 'performance' ? (
        <PerformanceTeamView
          athletes={athletesWithStatus}
          perfData={perfData}
          onPickAthlete={setSelectedAthlete}
        />
      ) : (
        <>
      {/* Org KPIs */}
      <div style={styles.pKpiGrid}>
        <Kpi label="Squad" value={totalAthletes} sub="active athletes" />
        <Kpi label="Wellness completion" value={`${wellnessCompletion}%`} sub={wellnessOffCount > 0 ? `last 7 days · ${wellnessOffCount} opted out` : 'last 7 days'} trend={wellnessCompletion >= 70 ? 'up' : 'down'} />
        <AvailabilityKpi rows={rows} />
        <Kpi label="Flagged" value={flaggedCount} sub={`of ${totalAthletes} for review`} accent={flaggedCount > 0} />
      </div>

      {/* Search field — only show when there are enough athletes to warrant it */}
      {rows.length > 5 && (
        <div style={styles.rosterSearchWrap}>
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search athletes by name, position, ID…"
            style={styles.rosterSearchInput}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={styles.rosterSearchClear}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="tempo-scroll-x" style={styles.pFilters}>
        <span style={styles.pFilterLabel}>Show</span>
        {[
          { k: 'all', l: 'All' },
          { k: 'flagged', l: `Flagged (${rows.filter(r => r.flags.length > 0).length})` },
          { k: 'injured', l: `Injured (${rows.filter(r => (r.athlete.injuryStatus || 'available') !== 'available').length})` },
          { k: 'missing', l: 'Missing data' }
        ].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            style={{ ...styles.pFilterBtn, ...(filter === f.k ? styles.pFilterBtnActive : {}) }}>
            {f.l}
          </button>
        ))}
      </div>

      {/* Athlete list — grouped by club context if multiple */}
      <div style={styles.aList}>
        {(() => {
          // Group rows by club + squad (independents under "Private clients")
          const groups = {};
          visibleRows.forEach(r => {
            const team = r.athlete.team;
            const squad = r.athlete.squad;
            let groupKey;
            if (!team) groupKey = 'Private clients';
            else if (squad) groupKey = `${team} · ${squad}`;
            else groupKey = team;
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(r);
          });
          const groupNames = Object.keys(groups);
          const showHeaders = groupNames.length > 1; // only show headers if 2+ contexts

          // No results from search (but the user does have athletes)
          if (groupNames.length === 0 && rows.length > 0 && normalisedQuery) {
            return (
              <div style={styles.rosterSearchEmpty}>
                No athletes match "{searchQuery}".
                <button onClick={() => setSearchQuery('')} style={styles.rosterSearchEmptyBtn}>
                  Clear search
                </button>
              </div>
            );
          }

          // Brand-new staff with no athletes: show the empty-caseload welcome
          if (groupNames.length === 0) {
            return (
              <div style={styles.firstRunCard}>
                <div style={styles.firstRunHead}>
                  <div style={styles.firstRunIcon}>◆</div>
                  <div>
                    <div style={styles.firstRunTitle}>Build your caseload</div>
                    <div style={styles.firstRunSubtitle}>No athletes yet</div>
                  </div>
                </div>

                <p style={{ fontSize: 13, color: '#5a564d', lineHeight: 1.5, margin: 0 }}>
                  Athletes choose who can see their data — so the way to build a caseload is to
                  have athletes invite you, or be added by a club admin.
                </p>

                <div style={styles.firstRunStep}>
                  <div style={styles.firstRunStepNum}>1</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.firstRunStepTitle}>Share your email with athletes</div>
                    <div style={styles.firstRunStepDesc}>
                      Tell them: "{currentUser?.email}". They invite you from their Privacy & access screen.
                    </div>
                  </div>
                </div>

                <div style={styles.firstRunStep}>
                  <div style={styles.firstRunStepNum}>2</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.firstRunStepTitle}>Get added by a club</div>
                    <div style={styles.firstRunStepDesc}>
                      If you work with a club, ask the club admin to add you in their Team & access screen.
                    </div>
                  </div>
                </div>

                <p style={styles.firstRunNote}>
                  Tempo doesn't let practitioners search for or claim athletes. Access always flows from the athlete.
                </p>
              </div>
            );
          }

          return groupNames.map(groupName => (
            <div key={groupName}>
              {showHeaders && (
                <div style={styles.rosterGroupHead}>
                  <div style={styles.rosterGroupLabel}>{groupName}</div>
                  <div style={styles.rosterGroupCount}>
                    {groups[groupName].length} {groups[groupName].length === 1 ? 'athlete' : 'athletes'}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {groups[groupName].map(r => {
                  const inj = r.athlete.injuryStatus || 'available';
                  const injColor = inj === 'available' ? '#3a8a4d'
                                  : inj === 'modified' ? '#d4a017'
                                  : '#c8472b';
                  const injLabel = inj === 'available' ? 'Available'
                                  : inj === 'modified' ? 'Modified'
                                  : 'Out';
                  return (
                    <button
                      key={r.athlete.id}
                      style={styles.pAthCard}
                      onClick={() => setSelectedAthlete(r.athlete.id)}
                    >
                      {/* Row 1: name + status indicators */}
                      <div style={styles.aCardTop}>
                        <div style={styles.aCardLeft}>
                          <div style={styles.aCardNameRow}>
                            <span style={{ ...styles.aTrafficDot, background: injColor }} aria-label={injLabel} />
                            <span style={styles.aCardName}>{r.athlete.name}</span>
                          </div>
                          <div style={styles.aCardMeta}>
                            {r.athlete.position}{r.athlete.playerId ? ` · ${r.athlete.playerId}` : ''}
                            {r.athlete.injuryNote && <span style={styles.aInjNote}> · {r.athlete.injuryNote}</span>}
                          </div>
                        </div>
                        <div style={styles.aCardRight}>
                          <StatusDot status={r.status} />
                        </div>
                      </div>

                      {/* Row 2: three stats */}
                      <div style={styles.aCardStats}>
                        <div style={styles.aStat}>
                          <div style={styles.aStatLabel}>Weekly load</div>
                          <div style={styles.aStatValue}>
                            {r.weekly.total.toLocaleString()}
                            <span style={styles.aStatUnit}> AU</span>
                          </div>
                        </div>
                        <div style={styles.aStat}>
                          <div style={styles.aStatLabel}>ACWR</div>
                          <div style={{
                            ...styles.aStatValue,
                            color: r.acwr > 1.5 ? '#c8472b' : r.acwr < 0.7 ? '#8a8275' : '#1a1a1a'
                          }}>
                            {r.acwr ? r.acwr.toFixed(2) : '—'}
                          </div>
                        </div>
                        <div style={styles.aStat}>
                          <div style={styles.aStatLabel}>Wellness</div>
                          <div style={{
                            ...styles.aStatValue,
                            color: r.wellAvg > 4 ? '#c8472b' : '#1a1a1a'
                          }}>
                            {r.wellAvg !== null ? r.wellAvg.toFixed(1) : '—'}
                            <span style={styles.aStatUnit}> /7</span>
                          </div>
                        </div>
                      </div>

                      {/* Row 3: flags + last session — only shown if interesting */}
                      {(r.flags.length > 0 || r.dayssince !== null) && (
                        <div style={styles.aCardFoot}>
                          <div style={styles.aFlagRow}>
                            {r.flags.slice(0, 2).map((f, i) => (
                              <span
                                key={i}
                                style={{
                                  ...styles.pFlag,
                                  ...(f.type === 'load' || f.type === 'wellness' ? styles.pFlagWarn : {})
                                }}
                              >
                                {f.label}
                              </span>
                            ))}
                            {r.flags.length > 2 && <span style={styles.pFlag}>+{r.flags.length - 2}</span>}
                          </div>
                          {r.dayssince !== null && (
                            <div style={styles.aLastSession}>
                              {r.dayssince === 0 ? 'trained today' : `${r.dayssince}d ago`}
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ));
        })()}
      </div>

      <div style={styles.pFootnote}>
        Tap any athlete for the full profile · Traffic light = injury status · ACWR uses 7d / 28d windows
      </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// UserBadge — current-user indicator with switch/logout menu
// ============================================================
// ============================================================
// AccessBlocked — shown in place of a section the user can't see
// ============================================================
function AccessBlocked({ title, body, requiredRole }) {
  return (
    <div style={styles.accessBlocked}>
      <div style={styles.accessBlockedIcon}>◔</div>
      <div style={styles.accessBlockedTitle}>{title || 'Access required'}</div>
      <p style={styles.accessBlockedBody}>
        {body || 'You don\'t have permission to view this content for this athlete.'}
      </p>
      {requiredRole && (
        <div style={styles.accessBlockedTag}>
          Requires: {requiredRole}
        </div>
      )}
    </div>
  );
}

// ============================================================
// UserBadge — current-user indicator with switch/logout menu
// ============================================================
function UserBadge({ user, onSwitch, onLogout, onInvite, onPrivacy }) {
  const [open, setOpen] = useState(false);
  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={styles.userBadge}
        aria-label="User menu"
      >
        <div style={styles.userBadgeAvatar}>{user.avatar}</div>
        <div style={styles.userBadgeNameCol}>
          <div style={styles.userBadgeName}>{user.name.split(' ')[0]}</div>
          <div style={styles.userBadgeRole}>{ROLE_LABELS[user.role] || user.role}</div>
        </div>
      </button>

      {open && (
        <div
          style={styles.userSheetBackdrop}
          onClick={() => setOpen(false)}
        >
          <div
            style={styles.userSheet}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.userSheetGrip} />

            <div style={styles.userSheetHead}>
              <div style={styles.userSheetAvatar}>{user.avatar}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.userSheetName}>{user.name}</div>
                <div style={styles.userSheetEmail}>{user.email}</div>
                <div style={styles.userSheetRole}>
                  {ROLE_LABELS[user.role] || user.role}
                  {user.title && ` · ${user.title}`}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={styles.userSheetClose}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {onPrivacy && (
              <button
                style={styles.userSheetItem}
                onClick={() => { setOpen(false); onPrivacy?.(); }}
              >
                <span>Privacy & sharing</span>
                <span style={styles.userSheetItemArrow}>→</span>
              </button>
            )}

            {onInvite && (
              <button
                style={styles.userSheetItem}
                onClick={() => { setOpen(false); onInvite?.(); }}
              >
                <span>Team & access</span>
                <span style={styles.userSheetItemArrow}>→</span>
              </button>
            )}

            <button
              style={styles.userSheetItem}
              onClick={() => { setOpen(false); onSwitch?.(); }}
            >
              <span>Switch identity (demo)</span>
              <span style={styles.userSheetItemArrow}>→</span>
            </button>

            <button
              style={{ ...styles.userSheetItem, color: '#9c3a23' }}
              onClick={() => { setOpen(false); onLogout?.(); }}
            >
              <span>Sign out</span>
              <span style={{ ...styles.userSheetItemArrow, color: '#9c3a23' }}>→</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, sub, trend, accent }) {
  return (
    <div style={{ ...styles.kpi, ...(accent ? styles.kpiAccent : {}) }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>
        {value}
        {trend === 'up' && <TrendingUp size={16} style={{ marginLeft: 6, color: '#1a1a1a' }} />}
        {trend === 'down' && <TrendingDown size={16} style={{ marginLeft: 6, color: '#c8472b' }} />}
      </div>
      <div style={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function AvailabilityKpi({ rows }) {
  const counts = rows.reduce((acc, r) => {
    const s = r.athlete.injuryStatus || 'available';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const green = counts.available || 0;
  const amber = counts.modified || 0;
  const red = counts.unavailable || 0;
  return (
    <div style={styles.kpi}>
      <div style={styles.kpiLabel}>Availability</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 4 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3a8a4d' }} />
          <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 22, fontWeight: 400 }}>{green}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d4a017' }} />
          <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 22, fontWeight: 400 }}>{amber}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#c8472b' }} />
          <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 22, fontWeight: 400 }}>{red}</span>
        </span>
      </div>
      <div style={styles.kpiSub}>fit · modified · out</div>
    </div>
  );
}

// ============================================================
// PerformanceTeamView — team-wide overview for performance staff
// ============================================================
function PerformanceTeamView({ athletes, perfData, onPickAthlete }) {
  const { injuries: allInjuries, tests: allTests, concussionBaselines: allBaselines,
          concussionIncidents: allIncidents, files: allFiles } = perfData;
  const [section, setSection] = useState('overview'); // overview | injuries | testing | concussion | files

  // Filter every dataset to only the athletes this user can see.
  // `athletes` is already filtered upstream by accessibleAthleteIds.
  const accessibleIds = new Set(athletes.map(a => a.id));
  const injuries = allInjuries.filter(i => accessibleIds.has(i.athleteId));
  const tests = allTests.filter(t => accessibleIds.has(t.athleteId));
  const concussionBaselines = allBaselines.filter(b => accessibleIds.has(b.athleteId));
  const concussionIncidents = allIncidents.filter(ci => accessibleIds.has(ci.athleteId));
  const files = allFiles.filter(f => accessibleIds.has(f.athleteId));

  const openInjuries = injuries.filter(i => i.status !== 'returned');
  const recentTests = [...tests].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  const athletesWithoutBaseline = athletes.filter(a =>
    !concussionBaselines.some(b => b.athleteId === a.id)
  );
  const activeConcussions = concussionIncidents.filter(ci => !ci.clearedOn);

  const findAthlete = (id) => athletes.find(a => a.id === id);

  return (
    <div>
      {/* Prominent upload action */}
      <div style={styles.perfTeamActionBar}>
        <button
          style={styles.perfTeamUploadBtn}
          onClick={() => setSection('upload')}
        >
          ↑ Upload GPS / fitness data
        </button>
      </div>

      {/* Sub-tabs */}
      <div style={styles.perfSubTabs}>
        {[
          { k: 'overview',   l: 'Overview' },
          { k: 'injuries',   l: `Injuries (${openInjuries.length})` },
          { k: 'testing',    l: 'Testing' },
          { k: 'concussion', l: 'Concussion' },
          { k: 'files',      l: 'Files' }
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setSection(t.k)}
            style={{ ...styles.perfSubTab, ...(section === t.k ? styles.perfSubTabActive : {}) }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {section === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Open injuries summary */}
          <div style={styles.perfPanel}>
            <div style={styles.perfPanelHead}>
              <span style={styles.perfPanelLabel}>Open injuries</span>
              <span style={styles.perfPanelCount}>{openInjuries.length}</span>
            </div>
            {openInjuries.length === 0 ? (
              <div style={styles.perfEmpty}>Everyone available — no current injuries.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {openInjuries.map(inj => {
                  const a = findAthlete(inj.athleteId);
                  if (!a) return null;
                  const days = Math.round((new Date() - new Date(inj.occurredOn)) / 86400000);
                  return (
                    <button
                      key={inj.id}
                      onClick={() => onPickAthlete(inj.athleteId)}
                      style={styles.perfRow}
                    >
                      <span style={{
                        ...styles.aTrafficDot,
                        background: inj.status === 'modified' ? '#d4a017' : '#c8472b'
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.perfRowName}>{a.name}</div>
                        <div style={styles.perfRowMeta}>
                          {inj.side ? `${inj.side} ` : ''}{inj.bodyRegion} · {inj.injuryType} · day {days}
                        </div>
                      </div>
                      <div style={styles.perfRowRight}>
                        <div style={styles.perfRtpLabel}>RTP</div>
                        <div style={styles.perfRtpValue}>
                          {inj.expectedRTP ? fmtShort(inj.expectedRTP) : '—'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent test results */}
          <div style={styles.perfPanel}>
            <div style={styles.perfPanelHead}>
              <span style={styles.perfPanelLabel}>Recent tests</span>
              <span style={styles.perfPanelCount}>{recentTests.length}</span>
            </div>
            {recentTests.length === 0 ? (
              <div style={styles.perfEmpty}>No tests recorded.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recentTests.slice(0, 8).map(t => {
                  const a = findAthlete(t.athleteId);
                  const meta = getTest(t.testKey);
                  if (!a) return null;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPickAthlete(t.athleteId)}
                      style={styles.perfTestRow}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.perfTestName}>{meta.name}</div>
                        <div style={styles.perfRowMeta}>{a.name} · {fmtShort(t.date)}</div>
                      </div>
                      <div style={styles.perfTestValue}>
                        {t.value}<span style={styles.perfTestUnit}> {meta.unit}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Concussion compliance */}
          <div style={styles.perfPanel}>
            <div style={styles.perfPanelHead}>
              <span style={styles.perfPanelLabel}>Concussion</span>
            </div>
            <div style={styles.perfStatLine}>
              <span>Active recoveries</span>
              <span style={styles.perfStatValue}>{activeConcussions.length}</span>
            </div>
            <div style={styles.perfStatLine}>
              <span>Baselines on record</span>
              <span style={styles.perfStatValue}>{concussionBaselines.length} / {athletes.length}</span>
            </div>
            {athletesWithoutBaseline.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#c8472b' }}>
                Missing baseline: {athletesWithoutBaseline.map(a => a.name.split(' ')[0]).join(', ')}
              </div>
            )}
          </div>

          {/* Files panel */}
          <div style={styles.perfPanel}>
            <div style={styles.perfPanelHead}>
              <span style={styles.perfPanelLabel}>Recent files</span>
              <span style={styles.perfPanelCount}>{files.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.slice(0, 5).map(f => {
                const a = findAthlete(f.athleteId);
                return (
                  <button
                    key={f.id}
                    onClick={() => onPickAthlete(f.athleteId)}
                    style={styles.perfFileRow}
                  >
                    <FileText size={14} color="#8a8275" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.perfFileName}>{f.name}</div>
                      <div style={styles.perfRowMeta}>
                        {a ? a.name : ''} · {f.type} · {fmtShort(f.date)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {section === 'injuries' && (
        <InjuriesTeamSection
          injuries={injuries}
          athletes={athletes}
          onPickAthlete={onPickAthlete}
        />
      )}

      {section === 'testing' && (
        <TestingTeamSection
          tests={tests}
          athletes={athletes}
          perfData={perfData}
          onPickAthlete={onPickAthlete}
        />
      )}

      {section === 'concussion' && (
        <ConcussionTeamSection
          baselines={concussionBaselines}
          incidents={concussionIncidents}
          athletes={athletes}
          onPickAthlete={onPickAthlete}
        />
      )}

      {section === 'files' && (
        <FilesTeamSection
          files={files}
          athletes={athletes}
          onPickAthlete={onPickAthlete}
        />
      )}

      {section === 'upload' && (
        <UploadDataSection
          athletes={athletes}
          perfData={perfData}
        />
      )}
    </div>
  );
}

function InjuriesTeamSection({ injuries, athletes, onPickAthlete }) {
  const [filter, setFilter] = useState('open'); // open | all | returned
  const findAthlete = (id) => athletes.find(a => a.id === id);

  const visible = injuries.filter(i => {
    if (filter === 'open') return i.status !== 'returned';
    if (filter === 'returned') return i.status === 'returned';
    return true;
  }).sort((a, b) => b.reportedOn.localeCompare(a.reportedOn));

  return (
    <div style={styles.perfPanel}>
      <div className="tempo-scroll-x" style={styles.pFilters}>
        <span style={styles.pFilterLabel}>Show</span>
        {[{ k: 'open', l: 'Open' }, { k: 'returned', l: 'Returned' }, { k: 'all', l: 'All' }].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            style={{ ...styles.pFilterBtn, ...(filter === f.k ? styles.pFilterBtnActive : {}) }}>
            {f.l}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={styles.perfEmpty}>No records match.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map(inj => {
            const a = findAthlete(inj.athleteId);
            if (!a) return null;
            const dotColor = inj.status === 'returned' ? '#3a8a4d'
                          : inj.status === 'modified' ? '#d4a017'
                          : '#c8472b';
            return (
              <button
                key={inj.id}
                onClick={() => onPickAthlete(inj.athleteId)}
                style={styles.perfInjCard}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <span style={{ ...styles.aTrafficDot, background: dotColor, marginTop: 6 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.perfRowName}>{a.name}</div>
                    <div style={styles.perfRowMeta}>
                      {inj.side ? `${inj.side} ` : ''}{inj.bodyRegion} · {inj.injuryType}
                    </div>
                  </div>
                </div>
                <div style={styles.perfInjGrid}>
                  <div><div style={styles.perfInjLabel}>Mechanism</div><div style={styles.perfInjVal}>{inj.mechanism}</div></div>
                  <div><div style={styles.perfInjLabel}>Reported</div><div style={styles.perfInjVal}>{fmtShort(inj.reportedOn)}</div></div>
                  <div><div style={styles.perfInjLabel}>RTP</div><div style={styles.perfInjVal}>{inj.actualRTP ? fmtShort(inj.actualRTP) : inj.expectedRTP ? `~${fmtShort(inj.expectedRTP)}` : '—'}</div></div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Convert a test value to a number for averaging. Handles "mm:ss" strings.
const testValueToNumber = (val) => {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    // Check for mm:ss format
    if (/^\d+:\d{2}$/.test(val)) {
      const [m, s] = val.split(':').map(Number);
      return m * 60 + s;
    }
    const parsed = Number(val);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
};

// Format a numeric value back into a test display string
const formatTestValue = (num, unit) => {
  if (num === null || num === undefined) return '—';
  if (unit === 'mm:ss') {
    const m = Math.floor(num / 60);
    const s = Math.round(num % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  // Round nicely depending on magnitude
  if (Math.abs(num) >= 100) return Math.round(num).toString();
  return num.toFixed(num < 10 ? 2 : 1);
};

function TestingTeamSection({ tests, athletes, perfData, onPickAthlete }) {
  const [category, setCategory] = useState('all');
  const [selectedTestKey, setSelectedTestKey] = useState(null);
  const [showBulkSession, setShowBulkSession] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Filter by category
  const filteredTests = tests.filter(t => {
    if (category === 'all') return true;
    return getTest(t.testKey).cat === category;
  });

  // For each test key, take the LATEST result per athlete
  // (so an athlete's pre-season + mid-season retest don't both count)
  const latestPerAthletePerTest = {};
  filteredTests.forEach(t => {
    const key = `${t.testKey}::${t.athleteId}`;
    if (!latestPerAthletePerTest[key] || latestPerAthletePerTest[key].date < t.date) {
      latestPerAthletePerTest[key] = t;
    }
  });

  // Group by test key
  const byTestKey = {};
  Object.values(latestPerAthletePerTest).forEach(t => {
    if (!byTestKey[t.testKey]) byTestKey[t.testKey] = [];
    byTestKey[t.testKey].push(t);
  });

  // Build summary rows
  const summary = Object.entries(byTestKey).map(([key, results]) => {
    const meta = getTest(key);
    const numericVals = results.map(r => testValueToNumber(r.value)).filter(v => v !== null);
    const mean = numericVals.length > 0
      ? numericVals.reduce((a, b) => a + b, 0) / numericVals.length
      : null;
    const lower = meta.better === 'lower';
    const best = numericVals.length > 0
      ? (lower ? Math.min(...numericVals) : Math.max(...numericVals))
      : null;
    const worst = numericVals.length > 0
      ? (lower ? Math.max(...numericVals) : Math.min(...numericVals))
      : null;
    const lastDate = results.map(r => r.date).sort().reverse()[0];

    return {
      testKey: key, meta, results,
      count: results.length, mean, best, worst, lastDate
    };
  }).sort((a, b) => {
    // Sort by category order, then alphabetical
    const catDiff = TEST_CATEGORIES.indexOf(a.meta.cat) - TEST_CATEGORIES.indexOf(b.meta.cat);
    if (catDiff !== 0) return catDiff;
    return a.meta.name.localeCompare(b.meta.name);
  });

  // If upload mode is open, show that
  if (showUpload) {
    return (
      <TestingUploadSection
        athletes={athletes}
        onSave={(results) => {
          results.forEach(r => perfData.addTest(r));
          setShowUpload(false);
        }}
        onCancel={() => setShowUpload(false)}
      />
    );
  }

  // If bulk-entry session is open, show that
  if (showBulkSession) {
    return (
      <BulkTestingSession
        athletes={athletes}
        onSave={(results) => {
          results.forEach(r => perfData.addTest(r));
          setShowBulkSession(false);
        }}
        onCancel={() => setShowBulkSession(false)}
      />
    );
  }

  // If a test is selected, show the drill-down
  if (selectedTestKey) {
    const item = summary.find(s => s.testKey === selectedTestKey);
    if (item) {
      return (
        <TestDrillDown
          item={item}
          athletes={athletes}
          onBack={() => setSelectedTestKey(null)}
          onPickAthlete={onPickAthlete}
        />
      );
    }
  }

  return (
    <div style={styles.perfPanel}>
      {/* Primary actions — live entry + bulk CSV import */}
      <div style={styles.testingActionRow}>
        <button
          style={styles.testingActionPrimary}
          onClick={() => setShowBulkSession(true)}
        >
          + Record testing session
        </button>
        <button
          style={styles.testingActionSecondary}
          onClick={() => setShowUpload(true)}
        >
          ↑ Upload CSV
        </button>
      </div>

      <div className="tempo-scroll-x" style={{ ...styles.pFilters, marginTop: 14 }}>
        <span style={styles.pFilterLabel}>Filter</span>
        <button onClick={() => setCategory('all')}
          style={{ ...styles.pFilterBtn, ...(category === 'all' ? styles.pFilterBtnActive : {}) }}>
          All
        </button>
        {TEST_CATEGORIES.filter(c => c !== 'Custom').map(c => (
          <button key={c} onClick={() => setCategory(c)}
            style={{ ...styles.pFilterBtn, ...(category === c ? styles.pFilterBtnActive : {}) }}>
            {c}
          </button>
        ))}
      </div>

      {summary.length === 0 ? (
        <div style={styles.perfEmpty}>No test results in this category.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {summary.map(item => (
            <button
              key={item.testKey}
              onClick={() => setSelectedTestKey(item.testKey)}
              style={styles.testSummaryCard}
            >
              <div style={styles.testSummaryTop}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.testSummaryName}>{item.meta.name}</div>
                  <div style={styles.testSummaryMeta}>
                    {item.meta.cat} · {item.count} {item.count === 1 ? 'athlete' : 'athletes'} · last {fmtShort(item.lastDate)}
                  </div>
                </div>
                <ChevronRight size={16} color="#8a8275" style={{ flexShrink: 0 }} />
              </div>

              <div style={styles.testSummaryStats}>
                <div style={styles.testSummaryStatMain}>
                  <div style={styles.testSummaryStatLabel}>Team average</div>
                  <div style={styles.testSummaryStatValue}>
                    {formatTestValue(item.mean, item.meta.unit)}
                    <span style={styles.testSummaryStatUnit}> {item.meta.unit}</span>
                  </div>
                </div>
                <div style={styles.testSummaryStatSpread}>
                  <div style={styles.testSummarySpreadRow}>
                    <span style={styles.testSummarySpreadLabel}>Best</span>
                    <span style={styles.testSummarySpreadValue}>
                      {formatTestValue(item.best, item.meta.unit)} {item.meta.unit}
                    </span>
                  </div>
                  <div style={styles.testSummarySpreadRow}>
                    <span style={styles.testSummarySpreadLabel}>Worst</span>
                    <span style={styles.testSummarySpreadValue}>
                      {formatTestValue(item.worst, item.meta.unit)} {item.meta.unit}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// ============================================================
// BulkTestingSession — record results for many athletes at once
// One test, one date, many athlete results.
// ============================================================
function BulkTestingSession({ athletes, onSave, onCancel }) {
  const [step, setStep] = useState('pickTest'); // pickTest | enterResults
  const [testKey, setTestKey] = useState(null);
  const [sessionDate, setSessionDate] = useState(today());
  const [results, setResults] = useState({}); // athleteId → { value, side?, note? }
  const [sessionNote, setSessionNote] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter by category + search query
  const normalisedQuery = searchQuery.trim().toLowerCase();
  const filteredKeys = TEST_CATALOG
    .filter(t => t.cat !== 'Custom') // hide custom from picker by default
    .filter(t => categoryFilter === 'all' || t.cat === categoryFilter)
    .filter(t => {
      if (!normalisedQuery) return true;
      return t.name.toLowerCase().includes(normalisedQuery)
          || t.cat.toLowerCase().includes(normalisedQuery)
          || (t.brief && t.brief.toLowerCase().includes(normalisedQuery));
    })
    .map(t => t.key);

  const test = testKey ? getTest(testKey) : null;
  // Bilateral tests need separate L/R inputs. Detect by name pattern —
  // Nordic, single-leg variants, isokinetic, etc. typically need both sides.
  const isBilateral = test && /nordic|single[- ]?leg|isokinetic|\bsl\b/i.test(test.name);

  // ===== Step 1: pick a test =====
  if (step === 'pickTest') {
    return (
      <div style={styles.pFrame}>
        <header style={styles.pHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={onCancel} style={styles.pBackBtn}>
              <X size={16} />
            </button>
            <div>
              <div style={styles.pHeaderKicker}>Step 1 of 2</div>
              <div style={styles.pOrgName}>Pick a test</div>
            </div>
          </div>
        </header>

        <p style={styles.aFilesIntro}>
          Choose which test you're running. You'll enter results for each athlete in the next step.
        </p>

        {/* Search field */}
        <div style={styles.testSearchWrap}>
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search tests by name, category, or description…"
            style={styles.testSearchInput}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={styles.testSearchClear}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="tempo-scroll-x" style={{ ...styles.pFilters, marginBottom: 14 }}>
          <span style={styles.pFilterLabel}>Filter</span>
          <button onClick={() => setCategoryFilter('all')}
            style={{ ...styles.pFilterBtn, ...(categoryFilter === 'all' ? styles.pFilterBtnActive : {}) }}>
            All
          </button>
          {TEST_CATEGORIES.filter(c => c !== 'Custom').map(c => (
            <button key={c} onClick={() => setCategoryFilter(c)}
              style={{ ...styles.pFilterBtn, ...(categoryFilter === c ? styles.pFilterBtnActive : {}) }}>
              {c}
            </button>
          ))}
        </div>

        {filteredKeys.length === 0 && (
          <div style={styles.testSearchEmpty}>
            No tests match "{searchQuery}". Try a different term or category.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredKeys.map(key => {
            const t = getTest(key);
            const isSelected = testKey === key;
            return (
              <button
                key={key}
                onClick={() => setTestKey(key)}
                style={{
                  ...styles.identityPick,
                  ...(isSelected ? styles.identityPickActive : {})
                }}
              >
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={styles.identityName}>{t.name}</div>
                  <div style={styles.identityMeta}>
                    {t.cat} · measured in {t.unit}
                    {t.better === 'lower' ? ' · lower is better' : ' · higher is better'}
                  </div>
                  {t.brief && (
                    <div style={styles.identityScope}>{t.brief}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div style={styles.inviteActions}>
          <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...styles.perfSaveBtn, opacity: testKey ? 1 : 0.4 }}
            disabled={!testKey}
            onClick={() => setStep('enterResults')}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ===== Step 2: enter results per athlete =====
  const updateResult = (athleteId, field, value) => {
    setResults({
      ...results,
      [athleteId]: { ...results[athleteId], [field]: value }
    });
  };

  const handleSave = () => {
    const records = [];
    Object.entries(results).forEach(([athleteId, r]) => {
      // Only save athletes that have a value entered
      if (!r || r.value === undefined || r.value === '' || r.value === null) return;
      const numericValue = parseFloat(r.value);
      if (Number.isNaN(numericValue)) return;
      // Bilateral tests (e.g. Nordic, isokinetic) — save L and R as separate records
      if (isBilateral && r.valueR !== undefined && r.valueR !== '' && r.valueR !== null) {
        records.push({
          id: `t_${Date.now()}_${athleteId}_L`,
          athleteId,
          testKey,
          date: sessionDate,
          value: numericValue,
          side: 'L',
          note: sessionNote || ''
        });
        records.push({
          id: `t_${Date.now()}_${athleteId}_R`,
          athleteId,
          testKey,
          date: sessionDate,
          value: parseFloat(r.valueR),
          side: 'R',
          note: sessionNote || ''
        });
      } else {
        records.push({
          id: `t_${Date.now()}_${athleteId}`,
          athleteId,
          testKey,
          date: sessionDate,
          value: numericValue,
          note: sessionNote || ''
        });
      }
    });
    onSave(records);
  };

  const enteredCount = Object.values(results).filter(r =>
    r && r.value !== undefined && r.value !== '' && r.value !== null
  ).length;

  return (
    <div style={styles.pFrame}>
      <header style={styles.pHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setStep('pickTest')} style={styles.pBackBtn}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={styles.pHeaderKicker}>Step 2 of 2</div>
            <div style={styles.pOrgName}>{test.name}</div>
          </div>
        </div>
      </header>

      {/* Session metadata */}
      <div style={styles.perfPanel}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={styles.perfFormLabel}>Date</div>
            <input
              type="date"
              style={styles.perfInput}
              value={sessionDate}
              onChange={e => setSessionDate(e.target.value)}
            />
          </div>
          <div style={{ flex: 2, minWidth: 200 }}>
            <div style={styles.perfFormLabel}>Session note (optional)</div>
            <input
              style={styles.perfInput}
              value={sessionNote}
              onChange={e => setSessionNote(e.target.value)}
              placeholder="e.g. Pre-season, indoor"
            />
          </div>
        </div>

        <div style={styles.bulkTestHint}>
          Enter {test.unit} per athlete. Skip anyone who didn't test — only entered results get saved.
          {isBilateral && ' For bilateral tests, enter L and R values separately.'}
        </div>
      </div>

      {/* Per-athlete inputs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        {athletes.map(a => {
          const r = results[a.id] || {};
          const initial = a.name.split(' ').map(p => p[0]).slice(0, 2).join('');
          return (
            <div key={a.id} style={styles.bulkTestRow}>
              <div style={styles.bulkTestAvatar}>{initial}</div>
              <div style={styles.bulkTestNameCol}>
                <div style={styles.bulkTestName}>{a.name}</div>
                <div style={styles.bulkTestMeta}>{a.position}{a.playerId ? ` · ${a.playerId}` : ''}</div>
              </div>
              {isBilateral ? (
                <div style={styles.bulkTestInputCol}>
                  <div style={styles.bulkTestBilateralRow}>
                    <input
                      type="number"
                      step="any"
                      style={styles.bulkTestInputSmall}
                      placeholder="L"
                      value={r.value || ''}
                      onChange={e => updateResult(a.id, 'value', e.target.value)}
                    />
                    <input
                      type="number"
                      step="any"
                      style={styles.bulkTestInputSmall}
                      placeholder="R"
                      value={r.valueR || ''}
                      onChange={e => updateResult(a.id, 'valueR', e.target.value)}
                    />
                  </div>
                  <div style={styles.bulkTestUnit}>{test.unit}</div>
                </div>
              ) : (
                <div style={styles.bulkTestInputCol}>
                  <input
                    type="number"
                    step="any"
                    style={styles.bulkTestInput}
                    placeholder="—"
                    value={r.value || ''}
                    onChange={e => updateResult(a.id, 'value', e.target.value)}
                  />
                  <div style={styles.bulkTestUnit}>{test.unit}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={styles.inviteActions}>
        <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
        <button
          style={{ ...styles.perfSaveBtn, opacity: enteredCount > 0 ? 1 : 0.4 }}
          disabled={enteredCount === 0}
          onClick={handleSave}
        >
          Save {enteredCount} {enteredCount === 1 ? 'result' : 'results'}
        </button>
      </div>
    </div>
  );
}


// ============================================================
// TestingUploadSection — CSV import for testing data
// Athletes do their own thing for fitness data; this is a club-side
// bulk importer for test results that already live in a spreadsheet.
// ============================================================
function TestingUploadSection({ athletes, onSave, onCancel }) {
  const [csvText, setCsvText] = useState('');
  const [parsedRows, setParsedRows] = useState(null); // null | array of {data, errors}
  const fileInputRef = React.useRef(null);

  // Build a lookup from name → athlete and playerId → athlete
  const athleteByKey = useMemo(() => {
    const m = {};
    athletes.forEach(a => {
      // Allow matching by id, playerId, or name (case-insensitive)
      m[a.id.toLowerCase()] = a;
      if (a.playerId) m[String(a.playerId).toLowerCase()] = a;
      m[a.name.toLowerCase()] = a;
    });
    return m;
  }, [athletes]);

  // Build a lookup from test key/name → test
  const testByKey = useMemo(() => {
    const m = {};
    TEST_CATALOG.forEach(t => {
      m[t.key.toLowerCase()] = t;
      m[t.name.toLowerCase()] = t;
    });
    return m;
  }, []);

  const parseCSV = (text) => {
    // Simple CSV parser — handles quoted fields with commas, skips blank lines and # comments
    const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
    if (lines.length === 0) return [];

    const parseLine = (line) => {
      const out = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          out.push(cur.trim());
          cur = '';
        } else {
          cur += c;
        }
      }
      out.push(cur.trim());
      return out;
    };

    const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[\s_-]+/g, '_'));
    return lines.slice(1).map((line, idx) => {
      const cells = parseLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i] || ''; });
      row._rowNum = idx + 2; // CSV row number including header
      return row;
    });
  };

  const validateRows = (rows) => {
    return rows.map(row => {
      const errors = [];

      // Find athlete (accept many possible column names)
      const athleteKey = (row.athlete || row.athlete_name || row.name || row.athlete_id || row.player_id || row.playerid || '').toLowerCase();
      const athlete = athleteByKey[athleteKey];
      if (!athleteKey) errors.push('Missing "athlete" column (athlete name, ID, or player ID)');
      else if (!athlete) errors.push(`Athlete "${row.athlete || row.athlete_name || row.name || row.athlete_id || athleteKey}" not found`);

      // Find test (accept either friendly name or internal key)
      const testKey = (row.test || row.test_name || row.test_key || '').toLowerCase();
      const test = testByKey[testKey];
      if (!testKey) errors.push('Missing "test" column (use the test name)');
      else if (!test) errors.push(`Test "${row.test || row.test_name || row.test_key || testKey}" not found in catalog`);

      // Validate date
      const date = row.date;
      if (!date) errors.push('Missing date column');
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`Date "${date}" must be in YYYY-MM-DD format`);

      // Validate value
      const value = parseFloat(row.value);
      if (row.value === undefined || row.value === '') errors.push('Missing value column');
      else if (Number.isNaN(value)) errors.push(`Value "${row.value}" is not a number`);

      // Validate side if present
      const side = row.side ? row.side.toUpperCase() : null;
      if (side && side !== 'L' && side !== 'R') errors.push(`Side "${row.side}" must be L or R (or blank)`);

      return {
        rowNum: row._rowNum,
        valid: errors.length === 0,
        errors,
        record: errors.length === 0 ? {
          id: `t_csv_${Date.now()}_${row._rowNum}`,
          athleteId: athlete.id,
          testKey: test.key,
          date,
          value,
          side: side || undefined,
          note: row.note || ''
        } : null
      };
    });
  };

  const handleParse = () => {
    if (!csvText.trim()) return;
    const rows = parseCSV(csvText);
    const validated = validateRows(rows);
    setParsedRows(validated);
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      setCsvText(text);
      const rows = parseCSV(text);
      const validated = validateRows(rows);
      setParsedRows(validated);
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    // Build a friendly CSV that uses ATHLETE NAMES and TEST NAMES rather than
    // internal IDs. The parser accepts either, but coaches think in names.
    const sampleA = athletes[0];
    const sampleB = athletes[1] || sampleA;
    const sampleC = athletes[2] || sampleA;
    const aName = sampleA?.name || 'Athlete name';
    const bName = sampleB?.name || 'Athlete name';
    const cName = sampleC?.name || 'Athlete name';
    const todayStr = today();

    // Group test names by category for the reference section
    const categories = ['Aerobic', 'Speed', 'Agility', 'Power', 'Strength', 'Body comp', 'Clinical'];
    const referenceLines = [];
    referenceLines.push('');
    referenceLines.push('# ============================================================');
    referenceLines.push('# AVAILABLE TESTS — copy any name from below into the "test" column');
    referenceLines.push('# ============================================================');
    categories.forEach(cat => {
      const inCat = TEST_CATALOG.filter(t => t.cat === cat);
      if (inCat.length === 0) return;
      referenceLines.push('');
      referenceLines.push(`# --- ${cat} ---`);
      inCat.forEach(t => {
        referenceLines.push(`#   ${t.name}  (${t.unit})`);
      });
    });

    const lines = [
      '# TEMPO TESTING DATA TEMPLATE',
      '#',
      '# How to use this file:',
      '# 1. Open in Excel, Google Sheets, or Numbers',
      '# 2. Keep the header row (athlete,test,date,value,side,note)',
      '# 3. Delete the example rows below and replace with your data',
      '# 4. Save as CSV',
      '# 5. Upload back into Tempo',
      '#',
      '# Tips:',
      '#   - "athlete" = the full athlete name as shown in Tempo',
      '#   - "test"    = the test name (full list at the bottom of this file)',
      '#   - "date"    = YYYY-MM-DD format (e.g. 2026-05-20)',
      '#   - "value"   = the result (just the number, no units)',
      '#   - "side"    = L or R for bilateral tests (leave blank otherwise)',
      '#   - "note"    = optional comment, like "pre-season" or "indoor"',
      '#',
      'athlete,test,date,value,side,note',
      `${aName},Yo-Yo IR1,${todayStr},1840,,Pre-season`,
      `${aName},Countermovement jump,${todayStr},38.2,,Force plate`,
      `${aName},Nordic peak force,${todayStr},340,L,NordBord`,
      `${aName},Nordic peak force,${todayStr},355,R,NordBord`,
      `${bName},Back squat 1RM,${todayStr},145,,New PB`,
      `${bName},Single-leg hop for distance,${todayStr},148,L,RTS battery`,
      `${bName},Single-leg hop for distance,${todayStr},153,R,RTS battery`,
      `${cName},20m sprint,${todayStr},2.94,,Timing gates`,
      ...referenceLines
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tempo-testing-template-${todayStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const validRecords = parsedRows
    ? parsedRows.filter(r => r.valid).map(r => r.record)
    : [];
  const invalidCount = parsedRows
    ? parsedRows.filter(r => !r.valid).length
    : 0;

  return (
    <div style={styles.pFrame}>
      <header style={styles.pHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onCancel} style={styles.pBackBtn}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={styles.pHeaderKicker}>Bulk import</div>
            <div style={styles.pOrgName}>Upload testing data</div>
          </div>
        </div>
      </header>

      <p style={styles.aFilesIntro}>
        Bring testing data in from a spreadsheet. Useful for backfilling historical results
        or importing exports from devices like NordBord, ForceFrame, or Catapult.
      </p>

      {/* Easiest start: download the template */}
      <div style={styles.testUploadHeroCard}>
        <div style={styles.testUploadHeroLabel}>Easiest way to start</div>
        <div style={styles.testUploadHeroTitle}>Download the template</div>
        <p style={styles.testUploadHeroBody}>
          It includes example rows so you can see the format, plus a list of every test name
          available. Open it in Excel or Google Sheets, replace the examples with your data, save,
          and upload below.
        </p>
        <button onClick={downloadTemplate} style={styles.testUploadHeroBtn}>
          ↓ Download CSV template
        </button>
      </div>

      {/* Quick reference for those skipping the template */}
      <div style={styles.uploadFormatCard}>
        <div style={styles.uploadFormatTitle}>Or build your own — quick reference</div>
        <div style={styles.uploadFormatExample}>
          <div style={styles.uploadFormatExampleHeader}>athlete,test,date,value,side,note</div>
          <div style={styles.uploadFormatExampleRow}>
            {athletes[0]?.name || 'Athlete name'},Yo-Yo IR1,{today()},1840,,Pre-season
          </div>
          <div style={styles.uploadFormatExampleRow}>
            {athletes[0]?.name || 'Athlete name'},Nordic peak force,{today()},340,L,NordBord
          </div>
        </div>
        <div style={styles.uploadFormatTips}>
          <div style={styles.uploadFormatTip}>
            <strong>athlete</strong> — the athlete's full name (case doesn't matter)
          </div>
          <div style={styles.uploadFormatTip}>
            <strong>test</strong> — the test name (e.g. "Back squat 1RM"). Use the template for the full list.
          </div>
          <div style={styles.uploadFormatTip}>
            <strong>date</strong> — YYYY-MM-DD format
          </div>
          <div style={styles.uploadFormatTip}>
            <strong>value</strong> — just the number, no units
          </div>
          <div style={styles.uploadFormatTip}>
            <strong>side</strong> — L or R for bilateral tests (Nordic, single-leg variants). Leave blank otherwise.
          </div>
          <div style={styles.uploadFormatTip}>
            <strong>note</strong> — optional comment
          </div>
        </div>
      </div>

      {/* File input + paste area */}
      <div style={styles.uploadInputCard}>
        <div style={styles.uploadInputHead}>
          <div style={styles.uploadInputLabel}>Choose a CSV file</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          style={{ fontSize: 13, fontFamily: 'inherit', marginBottom: 14 }}
        />
        <div style={styles.uploadInputDivider}>or paste CSV content below</div>
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          rows={6}
          placeholder="athlete,test,date,value,side,note&#10;Tom Mercer,Yo-Yo IR1,2026-05-20,1840,,Pre-season"
          style={styles.uploadTextarea}
        />
        <button
          onClick={handleParse}
          disabled={!csvText.trim()}
          style={{
            ...styles.uploadParseBtn,
            opacity: csvText.trim() ? 1 : 0.4
          }}
        >
          Validate & preview
        </button>
      </div>

      {/* Preview */}
      {parsedRows && (
        <div style={styles.uploadPreviewCard}>
          <div style={styles.uploadPreviewHead}>
            <div>
              <div style={styles.uploadPreviewTitle}>Preview</div>
              <div style={styles.uploadPreviewMeta}>
                {validRecords.length} valid · {invalidCount} {invalidCount === 1 ? 'error' : 'errors'}
              </div>
            </div>
          </div>

          {parsedRows.length === 0 ? (
            <div style={styles.uploadPreviewEmpty}>
              No rows found. Check that the CSV has a header row.
            </div>
          ) : (
            <div style={styles.uploadPreviewList}>
              {parsedRows.map((r, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.testUploadRow,
                    ...(r.valid ? {} : styles.testUploadRowInvalid)
                  }}
                >
                  <div style={styles.testUploadRowNum}>
                    Row {r.rowNum}
                  </div>
                  {r.valid ? (
                    <div style={styles.testUploadRowOk}>
                      <div style={styles.testUploadRowName}>
                        {athletes.find(a => a.id === r.record.athleteId)?.name} ·{' '}
                        {getTest(r.record.testKey).name}
                      </div>
                      <div style={styles.testUploadRowVal}>
                        {r.record.value} {getTest(r.record.testKey).unit}
                        {r.record.side ? ` (${r.record.side})` : ''}
                        {' · '}{r.record.date}
                      </div>
                    </div>
                  ) : (
                    <div style={styles.testUploadRowErr}>
                      {r.errors.map((e, j) => (
                        <div key={j} style={styles.testUploadErrText}>· {e}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={styles.inviteActions}>
        <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
        <button
          style={{
            ...styles.perfSaveBtn,
            opacity: validRecords.length > 0 ? 1 : 0.4
          }}
          disabled={validRecords.length === 0}
          onClick={() => onSave(validRecords)}
        >
          Import {validRecords.length} {validRecords.length === 1 ? 'result' : 'results'}
        </button>
      </div>
    </div>
  );
}


// Drill-down view: list of athletes who took a specific test
function TestDrillDown({ item, athletes, onBack, onPickAthlete }) {
  const { meta, results, mean, lastDate } = item;
  const findAthlete = (id) => athletes.find(a => a.id === id);
  const lower = meta.better === 'lower';

  // Sort athletes by performance (best first)
  const sorted = [...results].sort((a, b) => {
    const aVal = testValueToNumber(a.value);
    const bVal = testValueToNumber(b.value);
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return lower ? aVal - bVal : bVal - aVal;
  });

  return (
    <div>
      <button onClick={onBack} style={styles.testDrillBack}>
        <ArrowLeft size={14} /> All tests
      </button>

      <div style={styles.perfPanel}>
        {/* Header */}
        <div style={styles.testDrillHead}>
          <div style={styles.testDrillKicker}>{meta.cat} · {meta.better === 'higher' ? 'Higher is better' : meta.better === 'lower' ? 'Lower is better' : ''}</div>
          <div style={styles.testDrillTitle}>{meta.name}</div>
          <div style={styles.testDrillBrief}>{meta.brief}</div>
        </div>

        {/* Team summary band */}
        <div style={styles.testDrillSummary}>
          <div style={styles.testDrillSummaryCell}>
            <div style={styles.testSummaryStatLabel}>Team avg</div>
            <div style={styles.testDrillSummaryValue}>
              {formatTestValue(mean, meta.unit)}
              <span style={styles.testSummaryStatUnit}> {meta.unit}</span>
            </div>
          </div>
          <div style={styles.testDrillSummaryCell}>
            <div style={styles.testSummaryStatLabel}>Athletes</div>
            <div style={styles.testDrillSummaryValue}>{results.length}</div>
          </div>
          <div style={styles.testDrillSummaryCell}>
            <div style={styles.testSummaryStatLabel}>Last test</div>
            <div style={{ ...styles.testDrillSummaryValue, fontSize: 14, fontFamily: 'Inter, sans-serif' }}>
              {fmtShort(lastDate)}
            </div>
          </div>
        </div>

        {/* Athlete results list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          {sorted.map((r, idx) => {
            const a = findAthlete(r.athleteId);
            if (!a) return null;
            const numericVal = testValueToNumber(r.value);
            const delta = mean !== null && numericVal !== null ? numericVal - mean : null;
            const aboveAvg = delta !== null && (lower ? delta < 0 : delta > 0);

            return (
              <button
                key={r.id}
                onClick={() => onPickAthlete(r.athleteId)}
                style={styles.testDrillRow}
              >
                <div style={styles.testDrillRank}>{idx + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.testDrillAthName}>{a.name}</div>
                  <div style={styles.testDrillAthMeta}>
                    {a.position} · {fmtShort(r.date)}
                  </div>
                </div>
                <div style={styles.testDrillResult}>
                  <div style={styles.testDrillValue}>
                    {r.value}<span style={styles.testSummaryStatUnit}> {meta.unit}</span>
                  </div>
                  {delta !== null && Math.abs(delta) > 0.01 && (
                    <div style={{
                      ...styles.testDrillDelta,
                      color: aboveAvg ? '#3a8a4d' : '#c8472b'
                    }}>
                      {aboveAvg ? '+' : ''}{lower ? '' : (delta > 0 ? '+' : '')}{formatTestValue(delta, meta.unit === 'mm:ss' ? 'mm:ss' : '')} vs avg
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {results.some(r => r.notes) && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #efeadd' }}>
            <div style={styles.perfPanelLabel}>Notes</div>
            {results.filter(r => r.notes).map(r => {
              const a = findAthlete(r.athleteId);
              return (
                <div key={r.id} style={styles.testDrillNote}>
                  <span style={styles.testDrillNoteAuthor}>{a?.name}</span>
                  <span> · {r.notes}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}



function ConcussionTeamSection({ baselines, incidents, athletes, onPickAthlete }) {
  const findAthlete = (id) => athletes.find(a => a.id === id);
  const withBaseline = (a) => baselines.find(b => b.athleteId === a.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Active recoveries */}
      <div style={styles.perfPanel}>
        <div style={styles.perfPanelHead}>
          <span style={styles.perfPanelLabel}>Active recoveries</span>
          <span style={styles.perfPanelCount}>
            {incidents.filter(i => !i.clearedOn).length}
          </span>
        </div>
        {incidents.filter(i => !i.clearedOn).length === 0 ? (
          <div style={styles.perfEmpty}>No active concussion recoveries.</div>
        ) : (
          incidents.filter(i => !i.clearedOn).map(ci => {
            const a = findAthlete(ci.athleteId);
            if (!a) return null;
            const stageInfo = RTP_STAGES.find(s => s.stage === ci.currentRTPStage);
            return (
              <button key={ci.id} onClick={() => onPickAthlete(ci.athleteId)} style={styles.perfRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.perfRowName}>{a.name}</div>
                  <div style={styles.perfRowMeta}>
                    Incident {fmtShort(ci.date)} · Stage {ci.currentRTPStage}/6
                    {stageInfo && ` — ${stageInfo.label}`}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Baseline compliance */}
      <div style={styles.perfPanel}>
        <div style={styles.perfPanelHead}>
          <span style={styles.perfPanelLabel}>Baseline status</span>
          <span style={styles.perfPanelCount}>{baselines.length} / {athletes.length}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {athletes.map(a => {
            const b = withBaseline(a);
            return (
              <button key={a.id} onClick={() => onPickAthlete(a.id)} style={styles.perfRow}>
                <span style={{
                  ...styles.aTrafficDot,
                  background: b ? '#3a8a4d' : '#c8472b'
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.perfRowName}>{a.name}</div>
                  <div style={styles.perfRowMeta}>
                    {b ? `Baseline ${fmtShort(b.date)}` : 'No baseline on record'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recent incidents (closed + open) */}
      {incidents.length > 0 && (
        <div style={styles.perfPanel}>
          <div style={styles.perfPanelHead}>
            <span style={styles.perfPanelLabel}>All incidents</span>
            <span style={styles.perfPanelCount}>{incidents.length}</span>
          </div>
          {[...incidents].sort((a, b) => b.date.localeCompare(a.date)).map(ci => {
            const a = findAthlete(ci.athleteId);
            if (!a) return null;
            return (
              <button key={ci.id} onClick={() => onPickAthlete(ci.athleteId)} style={styles.perfRow}>
                <span style={{
                  ...styles.aTrafficDot,
                  background: ci.clearedOn ? '#3a8a4d' : '#c8472b'
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.perfRowName}>{a.name}</div>
                  <div style={styles.perfRowMeta}>
                    {fmtShort(ci.date)} · {ci.mechanism}
                    {ci.clearedOn ? ` · cleared ${fmtShort(ci.clearedOn)}` : ' · in progress'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilesTeamSection({ files, athletes, onPickAthlete }) {
  const [type, setType] = useState('all');
  const findAthlete = (id) => athletes.find(a => a.id === id);
  const types = ['all', 'screening', 'imaging', 'assessment', 'concussion', 'questionnaire', 'medical', 'video', 'training_log', 'other'];

  const visible = files
    // Athlete-uploaded files only visible to staff if shared
    .filter(f => f.uploadedByRole !== 'athlete' || f.sharedWithStaff !== false)
    .filter(f => type === 'all' || f.type === type)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div style={styles.perfPanel}>
      <div className="tempo-scroll-x" style={styles.pFilters}>
        <span style={styles.pFilterLabel}>Type</span>
        {types.map(t => (
          <button key={t} onClick={() => setType(t)}
            style={{ ...styles.pFilterBtn, ...(type === t ? styles.pFilterBtnActive : {}) }}>
            {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div style={styles.perfEmpty}>No files in this category.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visible.map(f => {
            const a = findAthlete(f.athleteId);
            return (
              <button
                key={f.id}
                onClick={() => onPickAthlete(f.athleteId)}
                style={styles.perfFileRow}
              >
                <FileText size={14} color="#8a8275" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.perfFileName}>{f.name}</div>
                  <div style={styles.perfRowMeta}>
                    {a ? a.name : ''} · {f.type} · {Math.round(f.sizeKb)}kb · {fmtShort(f.date)}
                    {f.uploadedByRole === 'athlete' && (
                      <span style={{ color: '#9c3a23', marginLeft: 4 }}> · uploaded by athlete</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// UploadDataSection — team-wide GPS/HR/fitness data upload
// ============================================================
function UploadDataSection({ athletes, perfData }) {
  const [showWizard, setShowWizard] = useState(false);
  const [uploadHistory, setUploadHistory] = useState([]);

  const handleSave = (rows, opts) => {
    const result = perfData.mergeUploadedSessions(rows, opts);
    setUploadHistory([
      {
        id: `up_${Date.now()}`,
        date: new Date().toISOString(),
        rows: rows.length,
        ...result
      },
      ...uploadHistory
    ]);
  };

  // Accessible-athlete filter for workout aggregates
  const accessibleIds = new Set(athletes.map(a => a.id));
  const accessibleWorkouts = perfData.workouts.filter(w => accessibleIds.has(w.athleteId));

  // Recent imports across the team (workouts with source='csv_upload')
  const recentImports = accessibleWorkouts
    .filter(w => w.source === 'csv_upload' || w.uploadSource)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  // Aggregate metrics across team
  const teamMetrics = accessibleWorkouts.reduce((acc, w) => {
    if (w.distanceM) acc.totalDistance += w.distanceM;
    if (w.playerLoad) acc.totalPlayerLoad += w.playerLoad;
    if (w.distanceM || w.playerLoad) acc.sessionsWithData++;
    return acc;
  }, { totalDistance: 0, totalPlayerLoad: 0, sessionsWithData: 0 });

  if (showWizard) {
    return (
      <GpsUploadWizard
        mode="staff"
        athletes={athletes}
        onSave={(rows, opts) => { handleSave(rows, opts); }}
        onCancel={() => setShowWizard(false)}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Hero / intro */}
      <div style={styles.perfPanel}>
        <div style={styles.uploadHeroLabel}>GPS · HR · External load</div>
        <div style={styles.uploadHeroTitle}>Import session data</div>
        <p style={styles.uploadHeroBody}>
          Upload CSV exports from Catapult, StatSports, Polar, Garmin, Strava or any other source.
          Rows are matched to athletes by name and attached to their training sessions, where they
          power per-athlete and team-wide GPS dashboards.
        </p>
        <button style={styles.perfAddBtn} onClick={() => setShowWizard(true)}>
          + Start upload
        </button>
      </div>

      {/* Team data summary */}
      <div style={styles.perfPanel}>
        <div style={styles.perfPanelHead}>
          <span style={styles.perfPanelLabel}>Team totals (28 days)</span>
        </div>
        <div style={styles.uploadSummaryGrid}>
          <div style={styles.uploadSummaryCellLarge}>
            <div style={styles.uploadSummaryLabel}>Total distance</div>
            <div style={styles.uploadSummaryLargeValue}>
              {(teamMetrics.totalDistance / 1000).toFixed(0)}<span style={styles.testSummaryStatUnit}> km</span>
            </div>
          </div>
          <div style={styles.uploadSummaryCellLarge}>
            <div style={styles.uploadSummaryLabel}>Total player load</div>
            <div style={styles.uploadSummaryLargeValue}>
              {Math.round(teamMetrics.totalPlayerLoad).toLocaleString()}
            </div>
          </div>
          <div style={styles.uploadSummaryCellLarge}>
            <div style={styles.uploadSummaryLabel}>Sessions w/ data</div>
            <div style={styles.uploadSummaryLargeValue}>
              {teamMetrics.sessionsWithData}
            </div>
          </div>
        </div>
      </div>

      {/* Upload history this session */}
      {uploadHistory.length > 0 && (
        <div style={styles.perfPanel}>
          <div style={styles.perfPanelHead}>
            <span style={styles.perfPanelLabel}>Recent imports (this session)</span>
          </div>
          {uploadHistory.map(h => (
            <div key={h.id} style={styles.uploadHistoryRow}>
              <div>
                <div style={styles.perfRowName}>
                  {h.added > 0 && `${h.added} added`}
                  {h.added > 0 && (h.replaced > 0 || h.merged > 0 || h.skipped > 0) && ' · '}
                  {h.replaced > 0 && `${h.replaced} replaced`}
                  {h.replaced > 0 && (h.merged > 0 || h.skipped > 0) && ' · '}
                  {h.merged > 0 && `${h.merged} merged`}
                  {h.merged > 0 && h.skipped > 0 && ' · '}
                  {h.skipped > 0 && `${h.skipped} skipped`}
                </div>
                <div style={styles.perfRowMeta}>
                  {h.rows} rows · {new Date(h.date).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recently-imported sessions */}
      {recentImports.length > 0 && (
        <div style={styles.perfPanel}>
          <div style={styles.perfPanelHead}>
            <span style={styles.perfPanelLabel}>Latest sessions with GPS data</span>
            <span style={styles.perfPanelCount}>{recentImports.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentImports.map(w => {
              const a = athletes.find(at => at.id === w.athleteId);
              return (
                <div key={w.id} style={styles.uploadRecentRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.perfRowName}>{a?.name || 'Unknown'}</div>
                    <div style={styles.perfRowMeta}>
                      {fmtShort(w.date)}
                      {w.uploadSource && ` · ${w.uploadSource}`}
                      {w.distanceM && ` · ${(w.distanceM / 1000).toFixed(1)}km`}
                      {w.playerLoad && ` · PL ${Math.round(w.playerLoad)}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// ContactsTeamView — staff directory of athlete contact details
// Respects per-athlete sharing preferences
// ============================================================
function ContactsTeamView({ athletes, currentUser, links, onPickAthlete }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState({}); // expanded user/athlete cards
  const [staffOpen, setStaffOpen] = useState(true);
  const [athletesOpen, setAthletesOpen] = useState(true);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const seed = getSeedData();
    setUsers(seed.teamUsers || []);
  }, []);

  // Staff = isStaff users other than current user
  // Each staff member is visible to other staff (professional context)
  const staffUsers = users.filter(u => u.isStaff && u.id !== currentUser?.id);

  // Apply search filter to both lists
  const matchesQuery = (str) => {
    if (!query) return true;
    return (str || '').toLowerCase().includes(query.toLowerCase());
  };

  const filteredStaff = staffUsers.filter(u =>
    matchesQuery(u.name) || matchesQuery(u.title) || matchesQuery(u.role) || matchesQuery(u.email)
  );

  const filteredAthletes = athletes.filter(a =>
    matchesQuery(a.name) || matchesQuery(a.position) || matchesQuery(a.playerId)
  );

  const toggle = (id) => {
    setExpanded({ ...expanded, [id]: !expanded[id] });
  };

  // What we show for an athlete depends on their share prefs + viewer's perms
  const visibleAthleteContact = (athlete) => {
    const share = athlete.contactSharing || {};
    const profile = athlete.profile || {};
    const canSeeMedical = canAccess(currentUser, athlete.id, 'view_medical', links);
    return {
      phone:    share.phone    ? profile.contactPhone  : null,
      email:    share.email    ? profile.contactEmail  : null,
      emergencyName:  share.emergencyContact ? profile.emergencyName  : null,
      emergencyPhone: share.emergencyContact ? profile.emergencyPhone : null,
      emergencyRelation: share.emergencyContact ? profile.emergencyRelation : null,
      gpName:   share.gp && canSeeMedical ? profile.gpName  : null,
      gpPhone:  share.gp && canSeeMedical ? profile.gpPhone : null,
      gpClinic: share.gp && canSeeMedical ? profile.gpClinic : null,
      contactNote: share.notes || null
    };
  };

  // For staff: simple — what they've shared
  const visibleStaffContact = (u) => {
    const share = u.contactSharing || { phone: true, email: true };
    return {
      phone: share.phone ? u.phone : null,
      email: share.email ? u.email : null,
      contactNote: u.contactNote || null
    };
  };

  return (
    <div>
      {/* Search */}
      <div style={styles.contactsSearchBar}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, role or position"
          style={styles.contactsSearchInput}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            style={styles.contactsSearchClear}
            aria-label="Clear"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div style={styles.contactsHint}>
        Showing only what each person has chosen to share. Athletes control their own privacy from the athlete app.
      </div>

      {/* ===== STAFF SECTION ===== */}
      <div style={styles.contactsSectionWrap}>
        <button
          onClick={() => setStaffOpen(!staffOpen)}
          style={styles.contactsSectionHead}
        >
          <div>
            <div style={styles.contactsSectionLabel}>Staff</div>
            <div style={styles.contactsSectionMeta}>
              {filteredStaff.length} {filteredStaff.length === 1 ? 'person' : 'people'} at the club
            </div>
          </div>
          <ChevronRight
            size={18}
            color="#5a564d"
            style={{
              transform: staffOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s ease'
            }}
          />
        </button>

        {staffOpen && (
          filteredStaff.length === 0 ? (
            <div style={{ ...styles.perfEmpty, marginTop: 8 }}>
              {query ? 'No staff match your search.' : 'No other staff to show.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {filteredStaff.map(u => {
                const c = visibleStaffContact(u);
                const isOpen = expanded[u.id];
                const hasAny = c.phone || c.email;

                return (
                  <div key={u.id} style={styles.contactCard}>
                    <button
                      onClick={() => toggle(u.id)}
                      style={styles.contactCardHead}
                    >
                      <div style={{ ...styles.contactCardAvatar, background: '#1a1a1a', color: '#f5f1e8' }}>
                        {u.avatar}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.contactCardName}>{u.name}</div>
                        <div style={styles.contactCardMeta}>
                          {u.title || ROLE_LABELS[u.role]}
                        </div>
                      </div>
                      <ChevronRight
                        size={16}
                        color="#8a8275"
                        style={{
                          transform: isOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s ease'
                        }}
                      />
                    </button>

                    {isOpen && (
                      <div style={styles.contactCardBody}>
                        {!hasAny ? (
                          <div style={styles.contactNotShared}>
                            {u.name.split(' ')[0]} hasn't shared direct contact details.
                          </div>
                        ) : (
                          <div style={styles.contactSection}>
                            <div style={styles.contactSectionLabelInner}>Direct</div>
                            {c.phone && (
                              <a href={`tel:${c.phone}`} style={styles.contactRow}>
                                <span style={styles.contactRowLabel}>Phone</span>
                                <span style={styles.contactRowValue}>{c.phone}</span>
                              </a>
                            )}
                            {c.email && (
                              <a href={`mailto:${c.email}`} style={styles.contactRow}>
                                <span style={styles.contactRowLabel}>Email</span>
                                <span style={styles.contactRowValue}>{c.email}</span>
                              </a>
                            )}
                          </div>
                        )}

                        {c.contactNote && (
                          <div style={styles.contactNote}>
                            <span style={styles.contactNoteIcon}>◌</span>
                            <span>{c.contactNote}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ===== ATHLETES SECTION ===== */}
      <div style={styles.contactsSectionWrap}>
        <button
          onClick={() => setAthletesOpen(!athletesOpen)}
          style={styles.contactsSectionHead}
        >
          <div>
            <div style={styles.contactsSectionLabel}>Athletes</div>
            <div style={styles.contactsSectionMeta}>
              {filteredAthletes.length} of {athletes.length} {athletes.length === 1 ? 'athlete' : 'athletes'} accessible
            </div>
          </div>
          <ChevronRight
            size={18}
            color="#5a564d"
            style={{
              transform: athletesOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s ease'
            }}
          />
        </button>

        {athletesOpen && (
          filteredAthletes.length === 0 ? (
            <div style={{ ...styles.perfEmpty, marginTop: 8 }}>
              {query ? 'No athletes match your search.' : 'No athletes accessible.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {filteredAthletes.map(a => {
                const c = visibleAthleteContact(a);
                const isOpen = expanded[a.id];
                const hasAny = c.phone || c.email || c.emergencyName || c.gpName;
                const initial = a.name.split(' ').map(p => p[0]).slice(0, 2).join('');

                return (
                  <div key={a.id} style={styles.contactCard}>
                    <button
                      onClick={() => toggle(a.id)}
                      style={styles.contactCardHead}
                    >
                      <div style={styles.contactCardAvatar}>{initial}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.contactCardName}>{a.name}</div>
                        <div style={styles.contactCardMeta}>
                          {a.position} · {a.playerId}
                        </div>
                      </div>
                      <ChevronRight
                        size={16}
                        color="#8a8275"
                        style={{
                          transform: isOpen ? 'rotate(90deg)' : 'none',
                          transition: 'transform 0.15s ease'
                        }}
                      />
                    </button>

                    {isOpen && (
                      <div style={styles.contactCardBody}>
                        {!hasAny ? (
                          <div style={styles.contactNotShared}>
                            {a.name.split(' ')[0]} hasn't shared any contact details with you.
                          </div>
                        ) : (
                          <>
                            {(c.phone || c.email) && (
                              <div style={styles.contactSection}>
                                <div style={styles.contactSectionLabelInner}>Direct</div>
                                {c.phone && (
                                  <a href={`tel:${c.phone}`} style={styles.contactRow}>
                                    <span style={styles.contactRowLabel}>Phone</span>
                                    <span style={styles.contactRowValue}>{c.phone}</span>
                                  </a>
                                )}
                                {c.email && (
                                  <a href={`mailto:${c.email}`} style={styles.contactRow}>
                                    <span style={styles.contactRowLabel}>Email</span>
                                    <span style={styles.contactRowValue}>{c.email}</span>
                                  </a>
                                )}
                              </div>
                            )}

                            {c.emergencyName && (
                              <div style={styles.contactSection}>
                                <div style={styles.contactSectionLabelInner}>Emergency</div>
                                <div style={styles.contactRow}>
                                  <span style={styles.contactRowLabel}>{c.emergencyRelation || 'Contact'}</span>
                                  <span style={styles.contactRowValue}>{c.emergencyName}</span>
                                </div>
                                {c.emergencyPhone && (
                                  <a href={`tel:${c.emergencyPhone}`} style={styles.contactRow}>
                                    <span style={styles.contactRowLabel}>Phone</span>
                                    <span style={styles.contactRowValue}>{c.emergencyPhone}</span>
                                  </a>
                                )}
                              </div>
                            )}

                            {c.gpName && (
                              <div style={{ ...styles.contactSection, ...styles.contactSectionMedical }}>
                                <div style={styles.contactSectionLabelMedical}>
                                  GP / Clinician · medical-restricted
                                </div>
                                <div style={styles.contactRow}>
                                  <span style={styles.contactRowLabel}>Doctor</span>
                                  <span style={styles.contactRowValue}>{c.gpName}</span>
                                </div>
                                {c.gpClinic && (
                                  <div style={styles.contactRow}>
                                    <span style={styles.contactRowLabel}>Clinic</span>
                                    <span style={styles.contactRowValue}>{c.gpClinic}</span>
                                  </div>
                                )}
                                {c.gpPhone && (
                                  <a href={`tel:${c.gpPhone}`} style={styles.contactRow}>
                                    <span style={styles.contactRowLabel}>Phone</span>
                                    <span style={styles.contactRowValue}>{c.gpPhone}</span>
                                  </a>
                                )}
                              </div>
                            )}

                            {c.contactNote && (
                              <div style={styles.contactNote}>
                                <span style={styles.contactNoteIcon}>◌</span>
                                <span>{c.contactNote}</span>
                              </div>
                            )}
                          </>
                        )}

                        <button
                          onClick={() => onPickAthlete(a.id)}
                          style={styles.contactProfileBtn}
                        >
                          Open full profile →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}


function StatusDot({ status }) {
  const map = {
    'Stable': { color: '#4a6741', label: 'Stable' },
    'Monitor': { color: '#d4a017', label: 'Monitor' },
    'Review': { color: '#c8472b', label: 'Review' },
    'Missing Data': { color: '#8a8275', label: 'Missing' }
  };
  const s = map[status] || map['Stable'];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, letterSpacing: '0.03em' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
      {s.label}
    </span>
  );
}

// ============================================================
// Athlete detail (practitioner view)
// ============================================================
// ============================================================
// NoteComposer — practitioner-side composer for athlete notes
// Visibility decides who sees it:
//   - athlete: athlete + all staff (coordination notes on their home)
//   - staff: staff with view_notes only
//   - medical: staff with view_medical only
// ============================================================
function NoteComposer({ onSave, currentUser, canMedical }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState('athlete');
  const [type, setType] = useState('Coordination');

  if (!open) {
    return (
      <button style={styles.noteComposerOpenBtn} onClick={() => setOpen(true)}>
        + Add a note
      </button>
    );
  }

  const visOptions = [
    { k: 'athlete', l: 'Athlete + staff', desc: 'Shows on the athlete\'s home as a coordination note. Best for quick instructions.' },
    { k: 'staff',   l: 'Staff only',      desc: 'Coaches and clinicians with notes access. Not visible to the athlete.' }
  ];
  if (canMedical) {
    visOptions.push({ k: 'medical', l: 'Medical-restricted', desc: 'Only staff with medical access. For clinical detail.' });
  }

  const handleSave = () => {
    if (!text.trim()) return;
    onSave({
      text: text.trim(),
      visibility,
      type
    });
    setText('');
    setOpen(false);
  };

  return (
    <div style={styles.noteComposerCard}>
      <div style={styles.noteComposerHead}>
        <div style={styles.noteComposerTitle}>New note</div>
        <button
          onClick={() => { setOpen(false); setText(''); }}
          style={styles.userSheetClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        placeholder={
          visibility === 'athlete'
            ? "e.g. Skip the conditioning block tonight — just the gym session."
            : "Add your note here…"
        }
        style={styles.noteComposerTextarea}
        autoFocus
      />

      <div style={styles.noteComposerLabel}>Who can see this?</div>
      <div style={styles.noteComposerVisRow}>
        {visOptions.map(o => (
          <button
            key={o.k}
            onClick={() => setVisibility(o.k)}
            style={{
              ...styles.noteComposerVisBtn,
              ...(visibility === o.k ? styles.noteComposerVisBtnActive : {})
            }}
          >
            {o.l}
          </button>
        ))}
      </div>
      <p style={styles.noteComposerVisHint}>
        {visOptions.find(o => o.k === visibility)?.desc}
      </p>

      <div style={styles.noteComposerActions}>
        <button
          onClick={() => { setOpen(false); setText(''); }}
          style={styles.perfCancelBtn}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!text.trim()}
          style={{
            ...styles.perfSaveBtn,
            opacity: text.trim() ? 1 : 0.4
          }}
        >
          {visibility === 'athlete' ? 'Send to athlete' : 'Save note'}
        </button>
      </div>
    </div>
  );
}


function AthleteDetail({ row, notes, onAddNote, perfData, currentUser, links, recordAudit, onBack }) {
  const [tab, setTab] = useState('overview');
  const [showMedical, setShowMedical] = useState(false); // toggle for medical-restricted view
  const { athlete, weekly, acwr, mon, wellAvg, workouts, checkins } = row;
  const strain = calc.strain(workouts, today());

  // Permission checks for this specific athlete
  const can = (perm) => canAccess(currentUser, athlete.id, perm, links);
  const canMedical = can('view_medical');
  const canGps = can('view_gps');
  const canNotes = can('view_notes');
  const canEditNotes = can('edit_notes');
  const canInjuries = can('view_injuries');
  const canReports = can('view_reports');

  // 28-day chronic chart
  const chronicDays = [];
  const end = new Date(today());
  for (let i = 27; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    chronicDays.push({ date: d.toISOString().slice(0, 10), load: calc.dailyLoad(workouts, d.toISOString().slice(0, 10)) });
  }

  // Wellness trend
  const wellnessDays = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const c = checkins.find(x => x.date === ds);
    const score = c ? (c.fatigue + c.soreness + c.sleep + c.stress + c.mood + c.motivation) / 6 : null;
    wellnessDays.push({ date: ds, score });
  }

  return (
    <div style={styles.pFrame}>
      <header style={styles.pHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={onBack} style={styles.pBackBtn}>
            <ArrowLeft size={16} /> Roster
          </button>
          <span style={styles.pHeaderDivider}>/</span>
          <div>
            <div style={styles.pAthDetailName}>{athlete.name}</div>
            <div style={styles.pOrgSub}>{athlete.playerId} · {athlete.position} · {athlete.team}</div>
          </div>
        </div>
        <StatusDot status={row.status} />
      </header>

      <div className="tempo-scroll-x" style={styles.pTabBar}>
        {['overview', 'workload', 'wellness', 'notes', 'performance'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...styles.pTab, ...(tab === t ? styles.pTabActive : {}) }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={styles.pDetailBody}>
          {athlete.injuryStatus && athlete.injuryStatus !== 'available' && (
            <div style={{
              ...styles.injBanner,
              borderLeftColor: athlete.injuryStatus === 'modified' ? '#d4a017' : '#c8472b'
            }}>
              <span style={{
                ...styles.injBannerDot,
                background: athlete.injuryStatus === 'modified' ? '#d4a017' : '#c8472b'
              }} />
              <div>
                <div style={styles.injBannerLabel}>
                  {athlete.injuryStatus === 'modified' ? 'Modified training — return-to-play' : 'Unavailable — not fit'}
                </div>
                {athlete.injuryNote && (
                  <div style={styles.injBannerNote}>{athlete.injuryNote}</div>
                )}
              </div>
            </div>
          )}

          <div style={styles.pStatGrid}>
            <DetailStat label="Weekly load" value={weekly.total.toLocaleString()} unit="AU" />
            <DetailStat label="ACWR (7:28)" value={acwr ? acwr.toFixed(2) : '—'} warn={acwr > 1.5} />
            <DetailStat label="Monotony" value={mon ? mon.toFixed(2) : '—'} warn={mon > 2} />
            <DetailStat label="Strain" value={strain ? strain.toLocaleString() : '—'} />
            <DetailStat label="Wellness (7d)" value={wellAvg !== null ? wellAvg.toFixed(1) : '—'} unit="/7" warn={wellAvg > 4} />
            <DetailStat label="Sessions /28d" value={workouts.length} />
          </div>

          {athlete.profile && (
            <ProfilePanel
              athlete={athlete}
              showMedical={showMedical && canMedical}
              canMedical={canMedical}
              onToggleMedical={() => {
                if (!canMedical) return;
                const next = !showMedical;
                setShowMedical(next);
                if (next) recordAudit?.('view_medical', athlete.id, 'Revealed medical fields');
              }}
            />
          )}

          {perfData && (
            <TestingWidget
              athleteId={athlete.id}
              tests={perfData.tests}
            />
          )}

          {canGps
            ? <GpsWidget workouts={workouts} onView={() => recordAudit?.('view_gps', athlete.id, 'Viewed 7-day GPS summary')} />
            : <AccessBlocked
                title="GPS data is restricted"
                body="External load and HR data are only visible to staff with GPS access for this athlete."
                requiredRole="S&C coach, head coach, or consultant"
              />
          }

          {row.flags.length > 0 && (
            <div style={styles.pFlagBox}>
              <div style={styles.pFlagBoxLabel}>Open flags</div>
              {row.flags.map((f, i) => (
                <div key={i} style={styles.pFlagBoxItem}>
                  <AlertCircle size={14} color={f.type === 'load' || f.type === 'wellness' ? '#c8472b' : '#d4a017'} />
                  <span>{flagExplain(f, row)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={styles.pChartCard}>
            <div style={styles.pChartHead}>
              <span style={styles.pChartLabel}>Daily load · 28 days</span>
              <span style={styles.pChartSub}>RPE × duration (AU)</span>
            </div>
            <ChartBars data={chronicDays} height={120} />
          </div>

          <div style={styles.pChartCard}>
            <div style={styles.pChartHead}>
              <span style={styles.pChartLabel}>Wellness trend · 28 days</span>
              <span style={styles.pChartSub}>higher = more strained</span>
            </div>
            <WellnessChart data={wellnessDays} height={100} />
          </div>
        </div>
      )}

      {tab === 'workload' && (
        <div style={styles.pDetailBody}>
          <div style={styles.pChartCard}>
            <div style={styles.pChartHead}>
              <span style={styles.pChartLabel}>Session log</span>
              <span style={styles.pChartSub}>{workouts.length} sessions in window</span>
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {workouts.slice().sort((a, b) => b.date.localeCompare(a.date)).map(w => (
                <div key={w.id} style={styles.pSessionRow}>
                  <div style={{ flex: 1 }}>
                    <div style={styles.pSessionTitle}>{w.type}</div>
                    <div style={styles.pSessionMeta}>{fmtDate(w.date)} · {w.duration} min · RPE {w.rpe}</div>
                  </div>
                  <div style={styles.pSessionLoad}>{calc.sessionLoad(w.rpe, w.duration)} <span style={styles.pUnit}>AU</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'wellness' && (
        <div style={styles.pDetailBody}>
          <div style={styles.pChartCard}>
            <div style={styles.pChartHead}>
              <span style={styles.pChartLabel}>Check-in log</span>
              <span style={styles.pChartSub}>{checkins.length} entries</span>
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {checkins.slice().sort((a, b) => b.date.localeCompare(a.date)).map(c => {
                const avg = (c.fatigue + c.soreness + c.sleep + c.stress + c.mood + c.motivation) / 6;
                return (
                  <div key={c.id} style={styles.pSessionRow}>
                    <div style={{ flex: 1 }}>
                      <div style={styles.pSessionTitle}>{fmtDate(c.date)}</div>
                      <div style={styles.pSessionMeta}>
                        F{c.fatigue} · S{c.soreness} · Sl{c.sleep} · St{c.stress} · M{c.mood} · Mt{c.motivation}
                      </div>
                    </div>
                    <div style={{ ...styles.pSessionLoad, color: avg > 4 ? '#c8472b' : '#1a1a1a' }}>
                      {avg.toFixed(1)}<span style={styles.pUnit}>/7</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'notes' && (
        <div style={styles.pDetailBody}>
          {!canNotes ? (
            <AccessBlocked
              title="Notes are restricted"
              body="Notes from coaches, clinicians, and consultants are only visible to staff with notes access for this athlete."
              requiredRole="Coach, clinician, or consultant"
            />
          ) : (
            <>
              {canEditNotes && onAddNote && (
                <NoteComposer
                  onSave={(n) => onAddNote(n)}
                  currentUser={currentUser}
                  canMedical={canMedical}
                />
              )}
              {(() => {
                // Medical-visibility filter: even if you can see notes, you can't see
                // medical-restricted ones without view_medical
                const visibleNotes = notes.filter(n => {
                  if (n.visibility === 'medical' && !canMedical) return false;
                  return true;
                });
                return visibleNotes.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#8a8275' }}>
                    {notes.length === 0 ? 'No notes for this athlete yet.' : 'No notes visible at your access level.'}
                  </div>
                ) : visibleNotes.map(n => (
                  <div key={n.id} style={styles.pNoteCard}>
                    <div style={styles.pNoteHead}>
                      <span style={styles.pNoteType}>{n.type}</span>
                      <span style={styles.pNoteAuthor}>{n.author} · {n.role}</span>
                      <span style={styles.pNoteDate}>{fmtDate(n.date)}</span>
                    </div>
                    <p style={styles.pNoteText}>{n.text}</p>
                    <div style={styles.pNoteVis}>
                      Visibility: {n.visibility === 'athlete' ? 'Athlete + staff'
                                  : n.visibility === 'medical' ? 'Medical-restricted'
                                  : 'Staff only'}
                    </div>
                  </div>
                ));
              })()}
            </>
          )}
        </div>
      )}

      {tab === 'performance' && perfData && (
        <AthletePerformanceTab
          athlete={athlete}
          perfData={perfData}
          currentUser={currentUser}
          links={links}
          recordAudit={recordAudit}
        />
      )}
    </div>
  );
}

// ============================================================
// ProfilePanel — athlete profile detail with medical toggle
// ============================================================
function ProfilePanel({ athlete, showMedical, canMedical, onToggleMedical }) {
  const p = athlete.profile || {};
  const age = p.dob ? Math.floor((new Date() - new Date(p.dob)) / (365.25 * 24 * 60 * 60 * 1000)) : null;

  return (
    <div style={styles.profilePanel}>
      <div style={styles.profileHead}>
        <span style={styles.profileLabel}>Profile</span>
        {canMedical ? (
          <button
            onClick={onToggleMedical}
            style={{
              ...styles.profileMedToggle,
              ...(showMedical ? styles.profileMedToggleActive : {})
            }}
          >
            {showMedical ? 'Hide medical' : 'Show medical'}
          </button>
        ) : (
          <div style={styles.profileMedLocked} title="Requires clinician access">
            ◔ Medical access required
          </div>
        )}
      </div>

      <div style={styles.profileSection}>
        <div style={styles.profileSectionLabel}>Identity</div>
        <ProfileRow label="Full name" value={athlete.name} />
        {age !== null && <ProfileRow label="Age" value={`${age} (${fmtShort(p.dob)})`} />}
        <ProfileRow label="Player ID" value={athlete.playerId} />
        <ProfileRow label="Team" value={athlete.team} />
        <ProfileRow label="Position" value={athlete.position} />
      </div>

      {(p.height || p.weight || p.dominantSide || p.kickingFoot) && (
        <div style={styles.profileSection}>
          <div style={styles.profileSectionLabel}>Physical</div>
          {p.height && <ProfileRow label="Height" value={`${p.height} cm`} />}
          {p.weight && <ProfileRow label="Weight" value={`${p.weight} kg`} />}
          {p.dominantSide && <ProfileRow label="Dominant side" value={p.dominantSide} />}
          {p.kickingFoot && <ProfileRow label="Kicking foot" value={p.kickingFoot} />}
          {p.preferredSurface && <ProfileRow label="Preferred surface" value={p.preferredSurface} />}
          {p.yearsExperience !== undefined && <ProfileRow label="Years experience" value={`${p.yearsExperience} yrs`} />}
        </div>
      )}

      {(p.contactPhone || p.contactEmail || p.address) && (
        <div style={styles.profileSection}>
          <div style={styles.profileSectionLabel}>Contact</div>
          {p.contactPhone && <ProfileRow label="Phone" value={p.contactPhone} />}
          {p.contactEmail && <ProfileRow label="Email" value={p.contactEmail} />}
          {p.address && <ProfileRow label="Address" value={p.address} />}
        </div>
      )}

      {p.emergencyName && (
        <div style={styles.profileSection}>
          <div style={styles.profileSectionLabel}>Emergency contact</div>
          <ProfileRow label="Name" value={`${p.emergencyName} (${p.emergencyRelation})`} />
          <ProfileRow label="Phone" value={p.emergencyPhone} />
        </div>
      )}

      {showMedical ? (
        <div style={{ ...styles.profileSection, ...styles.profileMedSection }}>
          <div style={styles.profileMedHeader}>
            <span style={styles.profileMedLabel}>Medical (restricted)</span>
            <span style={styles.profileMedTag}>Clinician view</span>
          </div>
          {p.gpName && <ProfileRow label="GP" value={`${p.gpName} · ${p.gpClinic}`} />}
          {p.gpPhone && <ProfileRow label="GP phone" value={p.gpPhone} />}
          {p.bloodType && <ProfileRow label="Blood type" value={p.bloodType} />}
          {p.allergies && <ProfileRow label="Allergies" value={p.allergies} />}
          {p.medications && <ProfileRow label="Medications" value={p.medications} />}
          {p.medicalConditions && <ProfileRow label="Conditions" value={p.medicalConditions} />}
          {p.insurer && <ProfileRow label="Insurer" value={p.insurer} />}
        </div>
      ) : (
        <div style={styles.profileMedHidden}>
          Medical fields are hidden by default · clinician view only
        </div>
      )}

      {p.notes && (
        <div style={styles.profileSection}>
          <div style={styles.profileSectionLabel}>Coach notes</div>
          <div style={styles.profileNotes}>{p.notes}</div>
        </div>
      )}
    </div>
  );
}

function ProfileRow({ label, value }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div style={styles.profileRow}>
      <span style={styles.profileRowLabel}>{label}</span>
      <span style={styles.profileRowValue}>{value}</span>
    </div>
  );
}

// ============================================================
// TestingWidget — compact test summary on athlete overview
// ============================================================
function TestingWidget({ athleteId, tests }) {
  const myTests = tests.filter(t => t.athleteId === athleteId);

  if (myTests.length === 0) {
    return (
      <div style={styles.testWidget}>
        <div style={styles.testWidgetHead}>
          <span style={styles.testWidgetLabel}>Latest tests</span>
        </div>
        <div style={styles.testWidgetEmpty}>
          No test results recorded yet. Add results from the Performance tab.
        </div>
      </div>
    );
  }

  // Group by testKey, take latest per
  const latestByTest = {};
  myTests.forEach(t => {
    if (!latestByTest[t.testKey] || latestByTest[t.testKey].date < t.date) {
      latestByTest[t.testKey] = t;
    }
  });

  // Get previous for trend
  const trendByTest = {};
  Object.keys(latestByTest).forEach(key => {
    const sorted = myTests.filter(t => t.testKey === key)
      .sort((a, b) => b.date.localeCompare(a.date));
    trendByTest[key] = sorted[1] || null;
  });

  // Sort by category for stable display
  const items = Object.values(latestByTest)
    .sort((a, b) => {
      const aCat = getTest(a.testKey).cat;
      const bCat = getTest(b.testKey).cat;
      return TEST_CATEGORIES.indexOf(aCat) - TEST_CATEGORIES.indexOf(bCat);
    });

  return (
    <div style={styles.testWidget}>
      <div style={styles.testWidgetHead}>
        <span style={styles.testWidgetLabel}>Latest tests</span>
        <span style={styles.testWidgetCount}>{items.length} on file</span>
      </div>

      <div style={styles.testWidgetGrid}>
        {items.map(t => {
          const meta = getTest(t.testKey);
          const prev = trendByTest[t.testKey];
          let trend = null;
          if (prev && typeof t.value === 'number' && typeof prev.value === 'number') {
            const diff = t.value - prev.value;
            const improving = (meta.better === 'higher' && diff > 0) ||
                              (meta.better === 'lower' && diff < 0);
            trend = { diff, improving, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
          }

          return (
            <div key={t.testKey} style={styles.testWidgetCell}>
              <div style={styles.testWidgetCellLabel}>{meta.name}</div>
              <div style={styles.testWidgetCellValue}>
                {t.value}<span style={styles.testWidgetCellUnit}> {meta.unit}</span>
              </div>
              <div style={styles.testWidgetCellMeta}>
                {meta.cat} · {fmtShort(t.date)}
                {trend && (
                  <span style={{
                    color: trend.improving ? '#3a8a4d' : '#c8472b',
                    marginLeft: 6
                  }}>
                    {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}
                    {' '}{Math.abs(trend.diff).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// GpsWidget — recent 7-day GPS/HR summary on athlete overview
// ============================================================
function GpsWidget({ workouts, onView }) {
  // Last 7 days of workouts with any GPS / HR data
  const recent = (workouts || []).filter(w => {
    const dt = new Date(w.date);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 6);
    return dt >= cutoff && (w.distanceM || w.playerLoad || w.avgHr);
  });

  // Fire audit hook once when the widget actually shows data
  useEffect(() => {
    if (recent.length > 0) onView?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (recent.length === 0) return null;

  const totalDistance = recent.reduce((s, w) => s + (w.distanceM || 0), 0);
  const totalPlayerLoad = recent.reduce((s, w) => s + (w.playerLoad || 0), 0);
  const totalHighSpeed = recent.reduce((s, w) => s + (w.highSpeedDistanceM || 0), 0);
  const totalSprintDist = recent.reduce((s, w) => s + (w.sprintDistanceM || 0), 0);
  const totalSprints = recent.reduce((s, w) => s + (w.sprintEfforts || 0), 0);
  const totalDurationMin = recent.reduce((s, w) => s + (w.durationMin || 0), 0);
  const totalHours = Math.floor(totalDurationMin / 60);
  const totalRemainingMin = Math.round(totalDurationMin % 60);
  const maxVel = Math.max(0, ...recent.map(w => w.maxVelocityMps || 0));
  const avgHrVals = recent.filter(w => w.avgHr).map(w => w.avgHr);
  const avgHr = avgHrVals.length > 0 ? Math.round(avgHrVals.reduce((a, b) => a + b, 0) / avgHrVals.length) : null;
  const maxHr = Math.max(0, ...recent.map(w => w.maxHr || 0));

  // HR zones — sum across all sessions
  const totalZones = recent.reduce((acc, w) => {
    if (w.hrZones) {
      acc.z1 += w.hrZones.z1 || 0;
      acc.z2 += w.hrZones.z2 || 0;
      acc.z3 += w.hrZones.z3 || 0;
      acc.z4 += w.hrZones.z4 || 0;
      acc.z5 += w.hrZones.z5 || 0;
    }
    return acc;
  }, { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 });
  const totalZoneTime = totalZones.z1 + totalZones.z2 + totalZones.z3 + totalZones.z4 + totalZones.z5;

  const accels = recent.reduce((s, w) => s + (w.accelerations || 0), 0);
  const decels = recent.reduce((s, w) => s + (w.decelerations || 0), 0);

  return (
    <div style={styles.gpsWidget}>
      <div style={styles.gpsWidgetHead}>
        <span style={styles.testWidgetLabel}>GPS / external load · 7 days</span>
        <span style={styles.testWidgetCount}>{recent.length} {recent.length === 1 ? 'session' : 'sessions'}</span>
      </div>

      {/* Big four */}
      <div style={styles.gpsBigGrid}>
        <div style={styles.gpsBigCell}>
          <div style={styles.testSummaryStatLabel}>Training time</div>
          <div style={styles.gpsBigValue}>
            {totalHours > 0 ? totalHours : ''}
            {totalHours > 0 && <span style={styles.testSummaryStatUnit}>h </span>}
            {totalRemainingMin}
            <span style={styles.testSummaryStatUnit}>m</span>
          </div>
        </div>
        <div style={styles.gpsBigCell}>
          <div style={styles.testSummaryStatLabel}>Total distance</div>
          <div style={styles.gpsBigValue}>
            {(totalDistance / 1000).toFixed(1)}
            <span style={styles.testSummaryStatUnit}> km</span>
          </div>
        </div>
        <div style={styles.gpsBigCell}>
          <div style={styles.testSummaryStatLabel}>Player load</div>
          <div style={styles.gpsBigValue}>{Math.round(totalPlayerLoad).toLocaleString()}</div>
        </div>
        <div style={styles.gpsBigCell}>
          <div style={styles.testSummaryStatLabel}>High-speed</div>
          <div style={styles.gpsBigValue}>
            {(totalHighSpeed / 1000).toFixed(2)}
            <span style={styles.testSummaryStatUnit}> km</span>
          </div>
        </div>
        <div style={styles.gpsBigCell}>
          <div style={styles.testSummaryStatLabel}>Sprints</div>
          <div style={styles.gpsBigValue}>{totalSprints}</div>
        </div>
      </div>

      {/* Smaller details */}
      <div style={styles.gpsSmallGrid}>
        {maxVel > 0 && (
          <div>
            <div style={styles.gpsSmallLabel}>Max velocity</div>
            <div style={styles.gpsSmallValue}>{maxVel.toFixed(2)} m/s</div>
          </div>
        )}
        {totalSprintDist > 0 && (
          <div>
            <div style={styles.gpsSmallLabel}>Sprint distance</div>
            <div style={styles.gpsSmallValue}>{totalSprintDist}m</div>
          </div>
        )}
        {accels > 0 && (
          <div>
            <div style={styles.gpsSmallLabel}>Accels</div>
            <div style={styles.gpsSmallValue}>{accels}</div>
          </div>
        )}
        {decels > 0 && (
          <div>
            <div style={styles.gpsSmallLabel}>Decels</div>
            <div style={styles.gpsSmallValue}>{decels}</div>
          </div>
        )}
        {avgHr && (
          <div>
            <div style={styles.gpsSmallLabel}>Avg HR</div>
            <div style={styles.gpsSmallValue}>{avgHr} bpm</div>
          </div>
        )}
        {maxHr > 0 && (
          <div>
            <div style={styles.gpsSmallLabel}>Max HR</div>
            <div style={styles.gpsSmallValue}>{maxHr} bpm</div>
          </div>
        )}
      </div>

      {/* HR zones */}
      {totalZoneTime > 0 && (
        <div style={styles.gpsZonesBlock}>
          <div style={styles.gpsSmallLabel}>HR zones</div>
          <div style={styles.gpsZonesBar}>
            {['z1', 'z2', 'z3', 'z4', 'z5'].map((z, i) => {
              const pct = Math.round((totalZones[z] / totalZoneTime) * 100);
              const colors = ['#a8d5b6', '#7fc09a', '#d4a017', '#e87a47', '#c8472b'];
              return (
                <div
                  key={z}
                  style={{
                    width: `${pct}%`,
                    background: colors[i],
                    minWidth: pct > 0 ? 4 : 0
                  }}
                  title={`Zone ${i + 1}: ${pct}%`}
                />
              );
            })}
          </div>
          <div style={styles.gpsZonesLegend}>
            {['Z1', 'Z2', 'Z3', 'Z4', 'Z5'].map((z, i) => (
              <span key={z} style={styles.gpsZoneLabel}>
                {z} {Math.round((totalZones[`z${i + 1}`] / totalZoneTime) * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// AthletePerformanceTab — per-athlete performance record
// ============================================================
function AthletePerformanceTab({ athlete, perfData, currentUser, links, recordAudit }) {
  const [section, setSection] = useState('injuries'); // injuries | testing | concussion | files
  const [showAddInjury, setShowAddInjury] = useState(false);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showAddBaseline, setShowAddBaseline] = useState(false);
  const [showAddFile, setShowAddFile] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  // Permission checks
  const can = (perm) => canAccess(currentUser, athlete.id, perm, links);
  const canInjuries = can('view_injuries');
  const canMedical = can('view_medical');
  const canEditInjuries = can('edit_injuries');
  const canGps = can('view_gps');

  const myInjuries = perfData.injuries
    .filter(i => i.athleteId === athlete.id)
    // Per-injury exclusion: athletes can hide a specific injury from a specific staff member
    .filter(i => !((i.sharing?.excluded || []).includes(currentUser?.id)))
    .sort((a, b) => b.reportedOn.localeCompare(a.reportedOn));

  const myTests = perfData.tests
    .filter(t => t.athleteId === athlete.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const myBaseline = perfData.concussionBaselines.find(b => b.athleteId === athlete.id);
  const myIncidents = perfData.concussionIncidents
    .filter(i => i.athleteId === athlete.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const myFiles = perfData.files
    .filter(f => f.athleteId === athlete.id)
    .filter(f => f.uploadedByRole !== 'athlete' || f.sharedWithStaff !== false)
    .sort((a, b) => b.date.localeCompare(a.date));

  const myWorkouts = (perfData.workouts || []).filter(w => w.athleteId === athlete.id);

  if (showUpload) {
    return (
      <div style={styles.pDetailBody}>
        <button
          onClick={() => setShowUpload(false)}
          style={styles.testDrillBack}
        >
          <ArrowLeft size={14} /> Back to {athlete.name}
        </button>
        <GpsUploadWizard
          mode="athlete"
          athleteId={athlete.id}
          athletes={[]}
          onSave={(rows, opts) => {
            perfData.mergeUploadedSessions(rows, opts);
          }}
          onCancel={() => setShowUpload(false)}
        />
      </div>
    );
  }

  return (
    <div style={styles.pDetailBody}>
      {/* Primary actions bar */}
      {canGps && (
        <div style={styles.perfActionBar}>
          <button style={styles.perfActionPrimary} onClick={() => setShowUpload(true)}>
            ↑ Upload GPS / fitness data
          </button>
        </div>
      )}

      {/* Sub-tabs */}
      <div style={styles.perfSubTabs}>
        {[
          { k: 'injuries',   l: `Injuries (${myInjuries.length})` },
          { k: 'testing',    l: `Testing (${myTests.length})` },
          { k: 'concussion', l: 'Concussion' },
          { k: 'files',      l: `Files (${myFiles.length})` }
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setSection(t.k)}
            style={{ ...styles.perfSubTab, ...(section === t.k ? styles.perfSubTabActive : {}) }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* INJURIES */}
      {section === 'injuries' && (
        !canInjuries ? (
          <AccessBlocked
            title="Injury record is restricted"
            body="Injury history, RTP tracking, and clinical notes are only available to staff with injury access."
            requiredRole="Physio, coach, or consultant"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {canEditInjuries && (
              <button style={styles.perfAddBtn} onClick={() => setShowAddInjury(true)}>
                + Log injury
              </button>
            )}

            {myInjuries.length === 0 ? (
              <div style={styles.perfEmpty}>No injuries recorded.</div>
            ) : (
              myInjuries.map(inj => {
                // Per-injury sharing override:
                //  - athletes can explicitly include a staff member who otherwise wouldn't see medical
                //  - (excluded staff are filtered out upstream — they don't see the injury at all)
                const sharing = inj.sharing || {};
                const includedForMedical = (sharing.included || []).includes(currentUser?.id);
                const canMedicalForThis = includedForMedical || canMedical;
                return (
                  <InjuryDetailCard
                    key={inj.id}
                    inj={inj}
                    canMedical={canMedicalForThis}
                    canEdit={canEditInjuries}
                    currentUser={currentUser}
                    onOpen={() => recordAudit?.('view_injuries', athlete.id, `Opened injury: ${inj.bodyRegion}`)}
                    onUpdate={(patch) => perfData.updateInjury(inj.id, patch)}
                  />
                );
              })
            )}

            {showAddInjury && canEditInjuries && (
              <InjuryForm
                athleteId={athlete.id}
                onSave={(inj) => { perfData.addInjury(inj); setShowAddInjury(false); }}
                onCancel={() => setShowAddInjury(false)}
              />
            )}
          </div>
        )
      )}

      {/* TESTING */}
      {section === 'testing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button style={styles.perfAddBtn} onClick={() => setShowAddTest(true)}>
            + Record test result
          </button>

          {myTests.length === 0 ? (
            <div style={styles.perfEmpty}>No test results yet.</div>
          ) : (
            <TestHistoryView tests={myTests} />
          )}

          {showAddTest && (
            <TestForm
              athleteId={athlete.id}
              onSave={(t) => { perfData.addTest(t); setShowAddTest(false); }}
              onCancel={() => setShowAddTest(false)}
            />
          )}
        </div>
      )}

      {/* CONCUSSION */}
      {section === 'concussion' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Baseline status */}
          <div style={styles.perfPanel}>
            <div style={styles.perfPanelHead}>
              <span style={styles.perfPanelLabel}>Baseline (SCAT6)</span>
              {myBaseline && (
                <span style={styles.perfBadgeGreen}>On file</span>
              )}
            </div>
            {myBaseline ? (
              <div>
                <div style={styles.perfRowMeta}>
                  Recorded {fmtShort(myBaseline.date)} · {myBaseline.administeredBy}
                </div>
                <div style={styles.baselineGrid}>
                  <BaselineCell label="Symptom score" value={myBaseline.symptomScore} max={132} better="lower" />
                  <BaselineCell label="Symptom severity" value={myBaseline.symptomSeverity} max={132} better="lower" />
                  <BaselineCell label="Orientation" value={myBaseline.orientationScore} max={5} better="higher" />
                  <BaselineCell label="Immediate memory" value={myBaseline.immediateMemory} max={10} better="higher" />
                  <BaselineCell label="Delayed memory" value={myBaseline.delayedMemory} max={10} better="higher" />
                  <BaselineCell label="Concentration" value={myBaseline.concentration} max={5} better="higher" />
                  <BaselineCell label="mBESS (errors)" value={myBaseline.mBESS} max={30} better="lower" />
                  <BaselineCell label="Tandem gait" value={myBaseline.tandemGait + 's'} better="lower" />
                </div>
                <div style={styles.perfStatLine}>
                  <span>Previous concussions</span>
                  <span style={styles.perfStatValue}>{myBaseline.previousConcussions}</span>
                </div>
                {myBaseline.notes && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#5a564d', fontStyle: 'italic' }}>
                    {myBaseline.notes}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={styles.perfEmpty}>No baseline on record.</div>
                <button style={styles.perfAddBtn} onClick={() => setShowAddBaseline(true)}>
                  + Record baseline
                </button>
              </div>
            )}
            {myBaseline && (
              <button
                style={{ ...styles.perfAddBtnGhost, marginTop: 10 }}
                onClick={() => setShowAddBaseline(true)}
              >
                Update baseline
              </button>
            )}
          </div>

          {/* Incidents */}
          <div style={styles.perfPanel}>
            <div style={styles.perfPanelHead}>
              <span style={styles.perfPanelLabel}>Incidents</span>
              <span style={styles.perfPanelCount}>{myIncidents.length}</span>
            </div>
            {myIncidents.length === 0 ? (
              <div style={styles.perfEmpty}>No concussion incidents recorded.</div>
            ) : (
              myIncidents.map(ci => {
                const stage = RTP_STAGES.find(s => s.stage === ci.currentRTPStage);
                return (
                  <div key={ci.id} style={styles.perfInjCard}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                      <span style={{
                        ...styles.aTrafficDot,
                        background: ci.clearedOn ? '#3a8a4d' : '#c8472b',
                        marginTop: 6
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={styles.perfRowName}>
                          {fmtShort(ci.date)} · {ci.mechanism}
                        </div>
                        <div style={styles.perfRowMeta}>
                          {ci.clearedOn ? `Cleared ${fmtShort(ci.clearedOn)}` : `In RTP · Stage ${ci.currentRTPStage}/6`}
                          {stage && !ci.clearedOn && ` — ${stage.label}`}
                        </div>
                      </div>
                    </div>
                    {ci.notes && (
                      <div style={{ fontSize: 12, color: '#5a564d', marginTop: 6 }}>
                        {ci.notes}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {showAddBaseline && (
            <BaselineForm
              athleteId={athlete.id}
              existing={myBaseline}
              onSave={(b) => { perfData.addBaseline(b); setShowAddBaseline(false); }}
              onCancel={() => setShowAddBaseline(false)}
            />
          )}
        </div>
      )}

      {/* FILES */}
      {section === 'files' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button style={styles.perfAddBtn} onClick={() => setShowAddFile(true)}>
            + Add file
          </button>

          {myFiles.length === 0 ? (
            <div style={styles.perfEmpty}>No files on record for this athlete.</div>
          ) : (
            myFiles.map(f => (
              <div key={f.id} style={styles.perfFileCard}>
                <FileText size={18} color="#5a564d" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.perfFileName}>{f.name}</div>
                  <div style={styles.perfRowMeta}>
                    {f.type} · {Math.round(f.sizeKb)}kb · {fmtShort(f.date)} · {f.uploadedBy}
                  </div>
                </div>
                {f.uploadedByRole === 'athlete' && (
                  <span style={styles.athleteUploadBadge}>athlete</span>
                )}
              </div>
            ))
          )}

          {showAddFile && (
            <FileForm
              athleteId={athlete.id}
              onSave={(f) => { perfData.addFile(f); setShowAddFile(false); }}
              onCancel={() => setShowAddFile(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function InjuryDetailCard({ inj, canMedical, canEdit, currentUser, onOpen, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmStageUndo, setConfirmStageUndo] = useState(null); // stage index to confirm undoing
  const [editingStatus, setEditingStatus] = useState(false);
  const dotColor = inj.status === 'returned' ? '#3a8a4d'
                : inj.status === 'modified' ? '#d4a017'
                : '#c8472b';
  const days = Math.round((new Date() - new Date(inj.occurredOn)) / 86400000);

  const rtpStagesCompleted = inj.rtpProgress ? inj.rtpProgress.filter(s => s.achieved).length : 0;
  const rtpStagesTotal = inj.rtpProgress ? inj.rtpProgress.length : 0;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onOpen?.();
  };

  const toggleStage = (index) => {
    if (!canEdit) return;
    const stage = inj.rtpProgress[index];
    if (stage.achieved) {
      // Undoing — confirm first to prevent accidents
      setConfirmStageUndo(index);
      return;
    }
    // Marking complete — no confirmation needed
    const newProgress = inj.rtpProgress.map((s, i) =>
      i === index ? {
        ...s,
        achieved: true,
        date: today(),
        completedBy: currentUser?.name || 'Unknown'
      } : s
    );
    onUpdate({ rtpProgress: newProgress });
  };

  const confirmUndoStage = () => {
    const newProgress = inj.rtpProgress.map((s, i) =>
      i === confirmStageUndo ? { ...s, achieved: false, date: null, completedBy: null } : s
    );
    onUpdate({ rtpProgress: newProgress });
    setConfirmStageUndo(null);
  };

  const updateStatus = (newStatus) => {
    onUpdate({
      status: newStatus,
      statusChangedAt: new Date().toISOString(),
      statusChangedBy: currentUser?.name || 'Unknown'
    });
    setEditingStatus(false);
  };

  return (
    <div style={styles.perfInjCard}>
      <button
        style={{ ...styles.perfInjHead, background: 'transparent', border: 'none', textAlign: 'left', width: '100%', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
        onClick={toggleExpanded}
      >
        <span style={{ ...styles.aTrafficDot, background: dotColor, marginTop: 6, marginRight: 10 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.perfRowName}>
            {inj.side ? `${inj.side} ` : ''}{inj.bodyRegion} · {inj.injuryType}
          </div>
          <div style={styles.perfRowMeta}>
            {fmtShort(inj.occurredOn)} · day {days} · {inj.status}
            {inj.recurrence && inj.recurrence !== 'New (first occurrence)' && (
              <span style={{ color: '#c8472b' }}> · {inj.recurrence.toLowerCase()}</span>
            )}
          </div>
        </div>
        <ChevronRight
          size={16}
          color="#8a8275"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
        />
      </button>

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #efeadd' }}>
          {/* RTP progress bar */}
          {rtpStagesTotal > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={styles.perfInjLabel}>Return-to-play progress</span>
                <span style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: 13 }}>
                  {rtpStagesCompleted}/{rtpStagesTotal}
                </span>
              </div>
              <div style={styles.rtpBar}>
                {inj.rtpProgress.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      ...styles.rtpBarSegment,
                      background: s.achieved ? '#3a8a4d' : '#e0d9c8'
                    }}
                    title={s.stage}
                  />
                ))}
              </div>
              <div style={{ marginTop: 8 }}>
                {inj.rtpProgress.map((s, i) => (
                  <div key={i}>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStage(i); }}
                      disabled={!canEdit}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 10px', fontSize: 12,
                        width: '100%',
                        background: canEdit && s.achieved ? '#f5f1e8' : 'transparent',
                        border: 'none', borderRadius: 6,
                        color: s.achieved ? '#1a1a1a' : '#8a8275',
                        cursor: canEdit ? 'pointer' : 'default',
                        fontFamily: 'inherit', textAlign: 'left',
                        marginBottom: 2
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                        <span style={{
                          width: 18, height: 18, borderRadius: 4,
                          border: s.achieved ? '2px solid #3a8a4d' : '2px solid #c8b894',
                          background: s.achieved ? '#3a8a4d' : 'transparent',
                          color: '#fdfbf5', display: 'inline-flex',
                          alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, flexShrink: 0
                        }}>
                          {s.achieved ? '✓' : ''}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>{s.stage}</span>
                      </span>
                      {s.date && (
                        <span style={{ fontSize: 10, color: '#8a8275', textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                          {fmtShort(s.date)}
                          {s.completedBy && (
                            <div style={{ fontSize: 9, color: '#b8b1a0', marginTop: 2 }}>by {s.completedBy}</div>
                          )}
                        </span>
                      )}
                    </button>
                    {confirmStageUndo === i && (
                      <div style={{
                        background: '#fdf5f0', border: '1px solid #f0cbb8',
                        borderRadius: 8, padding: 12, margin: '4px 0 8px',
                        fontSize: 12
                      }}>
                        <div style={{ color: '#9c3a23', marginBottom: 8 }}>
                          Mark "{s.stage}" as not yet achieved?
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            style={{ ...styles.deleteConfirmCancel, fontSize: 12, padding: '6px 12px' }}
                            onClick={() => setConfirmStageUndo(null)}
                          >
                            Cancel
                          </button>
                          <button
                            style={{ ...styles.deleteConfirmConfirm, fontSize: 12, padding: '6px 12px' }}
                            onClick={confirmUndoStage}
                          >
                            Yes, undo
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div style={{ fontSize: 10, color: '#8a8275', marginTop: 8, fontStyle: 'italic', textAlign: 'center' }}>
                  Tap a milestone to mark it complete. Anyone with edit access can contribute.
                </div>
              )}
            </div>
          )}

          {/* Status — editable with confirmation */}
          {canEdit && (
            <div style={styles.injStatusEdit}>
              <div style={styles.injStatusEditLabel}>Availability</div>
              <div style={styles.injStatusEditRow}>
                {['out', 'modified', 'returned'].map(s => (
                  <button
                    key={s}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (s === inj.status) return;
                      if (s === 'returned' && inj.status !== 'returned') {
                        // Closing the injury — confirm
                        setEditingStatus(true);
                      } else {
                        updateStatus(s);
                      }
                    }}
                    style={{
                      ...styles.injStatusBtn,
                      ...(s === inj.status ? styles.injStatusBtnActive : {})
                    }}
                  >
                    {s === 'out' ? 'Out' : s === 'modified' ? 'Modified training' : 'Returned'}
                  </button>
                ))}
              </div>
              {inj.statusChangedBy && (
                <div style={styles.injStatusMeta}>
                  Last changed by {inj.statusChangedBy}
                  {inj.statusChangedAt && ` · ${fmtShort(inj.statusChangedAt.slice(0,10))}`}
                </div>
              )}
              {editingStatus && (
                <div style={styles.deleteConfirm}>
                  <div style={styles.deleteConfirmText}>
                    Mark this injury as returned and close it? You can re-open it later if needed.
                  </div>
                  <div style={styles.deleteConfirmActions}>
                    <button
                      style={styles.deleteConfirmCancel}
                      onClick={() => setEditingStatus(false)}
                    >
                      Cancel
                    </button>
                    <button
                      style={{ ...styles.deleteConfirmConfirm, background: '#3a8a4d' }}
                      onClick={() => updateStatus('returned')}
                    >
                      Yes, close it
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Identity grid */}
          <div style={styles.perfInjGrid}>
            <div><div style={styles.perfInjLabel}>Mechanism</div><div style={styles.perfInjVal}>{inj.mechanism}</div></div>
            {inj.contactMechanism && (
              <div><div style={styles.perfInjLabel}>Contact</div><div style={styles.perfInjVal}>{inj.contactMechanism}</div></div>
            )}
            {inj.activity && (
              <div><div style={styles.perfInjLabel}>Activity</div><div style={styles.perfInjVal}>{inj.activity}</div></div>
            )}
            <div><div style={styles.perfInjLabel}>Severity</div><div style={styles.perfInjVal}>{inj.severity}/5</div></div>
            {inj.painScale !== undefined && inj.painScale !== null && (
              <div><div style={styles.perfInjLabel}>Pain (NRS)</div><div style={styles.perfInjVal}>{inj.painScale}/10</div></div>
            )}
            <div><div style={styles.perfInjLabel}>Reported by</div><div style={styles.perfInjVal}>{inj.reportedBy}</div></div>
            <div><div style={styles.perfInjLabel}>Expected RTP</div><div style={styles.perfInjVal}>{inj.expectedRTP ? fmtShort(inj.expectedRTP) : '—'}</div></div>
            {inj.actualRTP && (
              <div><div style={styles.perfInjLabel}>Actual RTP</div><div style={styles.perfInjVal}>{fmtShort(inj.actualRTP)}</div></div>
            )}
            {inj.followUp && (
              <div><div style={styles.perfInjLabel}>Next follow-up</div><div style={styles.perfInjVal}>{fmtShort(inj.followUp)}</div></div>
            )}
          </div>

          {inj.activityContext && (
            <div style={{ marginTop: 12 }}>
              <div style={styles.perfInjLabel}>Activity context</div>
              <div style={styles.perfDetailText}>{inj.activityContext}</div>
            </div>
          )}

          {inj.priorInjuryRef && (
            <div style={{ marginTop: 10 }}>
              <div style={styles.perfInjLabel}>Prior injury</div>
              <div style={styles.perfDetailText}>{inj.priorInjuryRef}</div>
            </div>
          )}

          {/* Clinical — medical-restricted */}
          {canMedical ? (
            <>
              {(inj.diagnosis || inj.icd10 || inj.osicsCode) && (
                <div style={styles.injSubHead}>Clinical</div>
              )}
              {inj.diagnosis && (
                <div style={{ marginTop: 6 }}>
                  <div style={styles.perfInjLabel}>Diagnosis</div>
                  <div style={styles.perfDetailText}>{inj.diagnosis}</div>
                </div>
              )}
              {(inj.icd10 || inj.osicsCode) && (
                <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
                  {inj.icd10 && (
                    <div>
                      <div style={styles.perfInjLabel}>ICD-10</div>
                      <div style={styles.perfInjVal}>{inj.icd10}</div>
                    </div>
                  )}
                  {inj.osicsCode && (
                    <div>
                      <div style={styles.perfInjLabel}>OSICS</div>
                      <div style={styles.perfInjVal}>{inj.osicsCode}</div>
                    </div>
                  )}
                </div>
              )}
              {inj.romLimitation && (
                <div style={{ marginTop: 10 }}>
                  <div style={styles.perfInjLabel}>ROM limitation</div>
                  <div style={styles.perfDetailText}>{inj.romLimitation}</div>
                </div>
              )}

              {/* Imaging */}
              {inj.imaging && inj.imaging !== 'None' && (
                <>
                  <div style={styles.injSubHead}>Imaging</div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                    <div>
                      <div style={styles.perfInjLabel}>Type</div>
                      <div style={styles.perfInjVal}>{inj.imaging}</div>
                    </div>
                    {inj.imagingDate && (
                      <div>
                        <div style={styles.perfInjLabel}>Date</div>
                        <div style={styles.perfInjVal}>{fmtShort(inj.imagingDate)}</div>
                      </div>
                    )}
                  </div>
                  {inj.imagingFindings && (
                    <div style={{ marginTop: 8 }}>
                      <div style={styles.perfInjLabel}>Findings</div>
                      <div style={styles.perfDetailText}>{inj.imagingFindings}</div>
                    </div>
                  )}
                </>
              )}

              {/* Plan */}
              {(inj.treatment || inj.prevention) && (
                <div style={styles.injSubHead}>Plan</div>
              )}
              {inj.treatment && (
                <div style={{ marginTop: 6 }}>
                  <div style={styles.perfInjLabel}>Treatment</div>
                  <div style={styles.perfDetailText}>{inj.treatment}</div>
                </div>
              )}
              {inj.prevention && (
                <div style={{ marginTop: 10 }}>
                  <div style={styles.perfInjLabel}>Prevention</div>
                  <div style={styles.perfDetailText}>{inj.prevention}</div>
                </div>
              )}
            </>
          ) : (
            (inj.diagnosis || (inj.imaging && inj.imaging !== 'None') || inj.treatment) && (
              <div style={styles.injMedicalLocked}>
                ◔ Clinical detail hidden · medical access required
              </div>
            )
          )}

          {inj.notes && (
            <div style={{ marginTop: 10 }}>
              <div style={styles.perfInjLabel}>Notes</div>
              <div style={styles.perfDetailText}>{inj.notes}</div>
            </div>
          )}

          {/* Quick status change — requires edit_injuries */}
          {canEdit && inj.status !== 'returned' && (
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {inj.status === 'unavailable' && (
                <button
                  style={styles.perfStatusBtn}
                  onClick={() => onUpdate({ status: 'modified' })}
                >
                  → Move to modified
                </button>
              )}
              {inj.status === 'modified' && (
                <button
                  style={styles.perfStatusBtn}
                  onClick={() => onUpdate({ status: 'returned', actualRTP: today() })}
                >
                  → Mark returned
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TestHistoryView({ tests }) {
  // Group by testKey
  const byTest = {};
  tests.forEach(t => {
    if (!byTest[t.testKey]) byTest[t.testKey] = [];
    byTest[t.testKey].push(t);
  });

  // Threshold for flagging significant deviation from rolling baseline
  const FLAG_THRESHOLD = 0.20; // 20%

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Object.entries(byTest).map(([key, results]) => {
        const meta = getTest(key);
        const sorted = [...results].sort((a, b) => b.date.localeCompare(a.date));
        const latest = sorted[0];
        const previous = sorted[1];
        let trend = null;
        if (previous && typeof latest.value === 'number' && typeof previous.value === 'number') {
          const diff = latest.value - previous.value;
          trend = { diff, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' };
        }
        const improving = trend && (
          (meta.better === 'higher' && trend.direction === 'up') ||
          (meta.better === 'lower' && trend.direction === 'down')
        );

        // Flag: latest vs rolling baseline of prior results (need 2+ priors for a baseline)
        let flag = null;
        const priorResults = sorted.slice(1);
        if (priorResults.length >= 2 && typeof latest.value === 'number') {
          const numericPriors = priorResults
            .map(r => r.value)
            .filter(v => typeof v === 'number');
          if (numericPriors.length >= 2) {
            const baseline = numericPriors.reduce((s, v) => s + v, 0) / numericPriors.length;
            if (baseline > 0) {
              const pctChange = (latest.value - baseline) / baseline;
              const worsening = (meta.better === 'higher' && pctChange < 0) ||
                                (meta.better === 'lower' && pctChange > 0);
              if (worsening && Math.abs(pctChange) >= FLAG_THRESHOLD) {
                flag = {
                  baseline,
                  pctChange,
                  direction: meta.better === 'higher' ? 'down' : 'up'
                };
              }
            }
          }
        }

        return (
          <div key={key} style={styles.perfInjCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={styles.perfRowName}>{meta.name}</div>
                <div style={styles.perfRowMeta}>{meta.cat} · {meta.brief}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={styles.perfTestValue}>
                  {latest.value}<span style={styles.perfTestUnit}> {meta.unit}</span>
                </div>
                {trend && (
                  <div style={{
                    fontSize: 11,
                    color: improving ? '#3a8a4d' : '#c8472b',
                    marginTop: 2,
                    letterSpacing: '0.02em'
                  }}>
                    {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {Math.abs(trend.diff).toFixed(2)} vs prior
                  </div>
                )}
              </div>
            </div>

            {/* Significant deviation flag — surfaces when latest is >20% off baseline */}
            {flag && (
              <div style={styles.testFlagPanel}>
                <div style={styles.testFlagIcon}>
                  <AlertCircle size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.testFlagTitle}>
                    {Math.abs(flag.pctChange * 100).toFixed(0)}% {flag.direction === 'down' ? 'below' : 'above'} baseline
                  </div>
                  <div style={styles.testFlagBody}>
                    Latest {latest.value} {meta.unit} vs rolling baseline {flag.baseline.toFixed(1)} {meta.unit}
                    ({priorResults.length} prior results). Worth a closer look.
                  </div>
                </div>
              </div>
            )}

            {sorted.length > 1 && (
              <div style={{ paddingTop: 10, borderTop: '1px solid #efeadd' }}>
                <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8a8275', marginBottom: 6 }}>
                  History
                </div>
                {sorted.slice(1).map(r => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: '#8a8275' }}>{fmtShort(r.date)}</span>
                    <span>{r.value} {meta.unit}</span>
                  </div>
                ))}
              </div>
            )}

            {latest.notes && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#5a564d', fontStyle: 'italic' }}>
                {latest.notes}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BaselineCell({ label, value, max, better }) {
  return (
    <div style={styles.baselineCell}>
      <div style={styles.baselineLabel}>{label}</div>
      <div style={styles.baselineValue}>
        {value}{max ? <span style={styles.baselineMax}>/{max}</span> : ''}
      </div>
    </div>
  );
}

// ============================================================
// Data entry forms
// ============================================================
// ============================================================
// GPS / FITNESS DATA UPLOAD WIZARD
// Reused by both staff (multi-athlete bulk) and athletes (own data)
// ============================================================
function GpsUploadWizard({ mode, athletes, athleteId, onSave, onCancel }) {
  // mode: 'staff' (resolves athletes by name) | 'athlete' (locks to one athleteId)
  const [step, setStep] = useState('pick'); // pick | map | confirm | done
  const [csvName, setCsvName] = useState('');
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvRows, setCsvRows] = useState([]);
  const [vendor, setVendor] = useState('generic');
  const [mapping, setMapping] = useState({});
  const [resolved, setResolved] = useState([]); // canonical rows after mapping
  const [conflicts, setConflicts] = useState([]); // existing workouts that would be replaced
  const [overwriteChoice, setOverwriteChoice] = useState('replace'); // replace | skip
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const fileInputRef = React.useRef(null);

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setCsvName(f.name);
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const parsed = parseCsv(text);
        if (parsed.headers.length === 0) {
          setError('Could not read the file. Make sure it\'s a CSV with a header row.');
          return;
        }
        if (parsed.rows.length === 0) {
          setError('File has headers but no data rows.');
          return;
        }
        setCsvHeaders(parsed.headers);
        setCsvRows(parsed.rows.map(polarPrepareRow));
        const detected = detectVendor(parsed.headers);
        setVendor(detected);
        const t = VENDOR_TEMPLATES.find(v => v.vendor === detected);
        // Build editable mapping: start from template, leave unknown columns as 'ignore'
        const initialMapping = {};
        parsed.headers.forEach(h => {
          const norm = h.toLowerCase().trim();
          initialMapping[h] = (t && t.mapping[norm]) || 'ignore';
        });
        // For Polar — also map Full Name we synthesised
        if (detected === 'polar') {
          initialMapping['Full Name'] = 'athleteName';
        }
        setMapping(initialMapping);
        setStep('map');
      } catch (err) {
        setError(`Failed to read file: ${err.message}`);
      }
    };
    reader.onerror = () => setError('Failed to read file.');
    reader.readAsText(f);
  };

  const updateMappingFor = (header, canonicalKey) => {
    setMapping({ ...mapping, [header]: canonicalKey });
  };

  const changeVendor = (newVendor) => {
    setVendor(newVendor);
    const t = VENDOR_TEMPLATES.find(v => v.vendor === newVendor);
    const newMap = {};
    csvHeaders.forEach(h => {
      const norm = h.toLowerCase().trim();
      newMap[h] = (t && t.mapping[norm]) || 'ignore';
    });
    if (newVendor === 'polar') newMap['Full Name'] = 'athleteName';
    setMapping(newMap);
  };

  const proceedToConfirm = () => {
    // Build resolved canonical rows from the current mapping
    const reverseMapping = {};
    Object.entries(mapping).forEach(([header, key]) => {
      if (key !== 'ignore') reverseMapping[header.toLowerCase().trim()] = key;
    });

    const out = csvRows.map((row, idx) => {
      const canonical = applyMapping(row, reverseMapping);
      // Athlete mode locks the athlete; staff mode resolves by name
      if (mode === 'athlete') {
        canonical.athleteId = athleteId;
        canonical.athleteResolved = true;
      } else {
        const id = resolveAthleteName(canonical.athleteName, athletes);
        canonical.athleteId = id;
        canonical.athleteResolved = !!id;
      }
      canonical._rowNum = idx + 2; // +2 for 1-index + header row
      return canonical;
    });

    setResolved(out);

    // Detect conflicts (only if we'd actually save them)
    const validRows = out.filter(r => r.athleteId && r.date);
    const conflictRows = validRows.filter(r => {
      // For demo: in real backend this would query the database
      // Here we just flag rows that "look like" existing sessions
      return false; // simplified — actual conflict detection happens at save time
    });
    setConflicts(conflictRows);
    setStep('confirm');
  };

  const handleSave = () => {
    const validRows = resolved.filter(r => r.athleteId && r.date);
    const skipped = resolved.length - validRows.length;
    // Strip helper fields before save
    const cleanRows = validRows.map(({ _rowNum, athleteResolved, athleteName, ...rest }) => rest);
    onSave(cleanRows, { overwriteChoice });
    setStats({
      imported: validRows.length,
      skipped,
      total: resolved.length,
      vendor: VENDOR_TEMPLATES.find(v => v.vendor === vendor)?.label || vendor
    });
    setStep('done');
  };

  const resetAndStartOver = () => {
    setStep('pick');
    setCsvHeaders([]);
    setCsvRows([]);
    setMapping({});
    setResolved([]);
    setConflicts([]);
    setError(null);
    setStats(null);
    setCsvName('');
  };

  // ----- STEP: PICK FILE -----
  if (step === 'pick') {
    return (
      <div style={styles.uploadCard}>
        <div style={styles.uploadHead}>
          <div>
            <div style={styles.uploadKicker}>Step 1 of 3</div>
            <div style={styles.uploadTitle}>Pick your data file</div>
          </div>
          <button onClick={onCancel} style={styles.uploadCancelX}><X size={16} /></button>
        </div>

        <p style={styles.uploadIntro}>
          Upload a CSV from Catapult, StatSports, Polar, Garmin, Strava, or any other GPS / fitness source.
          {mode === 'staff'
            ? ' Each row is matched to an athlete by name and merged onto their session.'
            : ' Each row is attached to one of your training sessions.'}
        </p>

        <div style={styles.uploadVendorChips}>
          {VENDOR_TEMPLATES.filter(v => v.vendor !== 'generic').map(t => (
            <div key={t.vendor} style={styles.uploadVendorChip}>{t.label}</div>
          ))}
          <div style={styles.uploadVendorChip}>+ Generic</div>
        </div>

        <label style={styles.uploadDropArea}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            style={{ display: 'none' }}
          />
          <div style={styles.uploadDropIcon}>↑</div>
          <div style={styles.uploadDropMain}>Tap to choose a CSV file</div>
          <div style={styles.uploadDropSub}>CSV files only · max ~10MB</div>
        </label>

        {error && (
          <div style={styles.uploadError}>{error}</div>
        )}

        <div style={styles.uploadActions}>
          <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  // ----- STEP: MAP COLUMNS -----
  if (step === 'map') {
    const template = VENDOR_TEMPLATES.find(v => v.vendor === vendor);
    const dateOk = Object.values(mapping).includes('date');
    const athleteOk = mode === 'athlete' || Object.values(mapping).includes('athleteName');

    return (
      <div style={styles.uploadCard}>
        <div style={styles.uploadHead}>
          <div>
            <div style={styles.uploadKicker}>Step 2 of 3</div>
            <div style={styles.uploadTitle}>Confirm column mapping</div>
          </div>
          <button onClick={onCancel} style={styles.uploadCancelX}><X size={16} /></button>
        </div>

        <div style={styles.uploadFileBar}>
          <FileText size={14} color="#5a564d" />
          <span style={styles.uploadFileBarName}>{csvName}</span>
          <span style={styles.uploadFileBarMeta}>{csvRows.length} rows</span>
        </div>

        <div style={styles.uploadVendorPicker}>
          <div style={styles.uploadVendorLabel}>Detected format</div>
          <select
            value={vendor}
            onChange={e => changeVendor(e.target.value)}
            style={styles.perfSelect}
          >
            {VENDOR_TEMPLATES.map(t => (
              <option key={t.vendor} value={t.vendor}>{t.label}</option>
            ))}
          </select>
          {template && (
            <div style={styles.uploadVendorDesc}>{template.description}</div>
          )}
        </div>

        <div style={styles.uploadMappingHead}>
          <span>CSV column</span>
          <span>→</span>
          <span>Goes to</span>
        </div>

        <div style={styles.uploadMappingList}>
          {csvHeaders.map(header => (
            <div key={header} style={styles.uploadMappingRow}>
              <div style={styles.uploadMappingHeader}>
                <div style={styles.uploadMappingHeaderName}>{header}</div>
                <div style={styles.uploadMappingHeaderSample}>
                  e.g. {(csvRows[0]?.[header] || '').substring(0, 30)}
                </div>
              </div>
              <ChevronRight size={14} color="#8a8275" style={{ flexShrink: 0 }} />
              <select
                value={mapping[header] || 'ignore'}
                onChange={e => updateMappingFor(header, e.target.value)}
                style={styles.uploadMappingSelect}
              >
                <option value="ignore">— ignore —</option>
                {CANONICAL_FIELDS.map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {(!dateOk || !athleteOk) && (
          <div style={styles.uploadError}>
            {!dateOk && 'Missing required mapping: session date. '}
            {!athleteOk && 'Missing required mapping: athlete name.'}
          </div>
        )}

        <div style={styles.uploadActions}>
          <button style={styles.perfCancelBtn} onClick={resetAndStartOver}>Pick different file</button>
          <button
            style={{ ...styles.perfSaveBtn, opacity: (dateOk && athleteOk) ? 1 : 0.5 }}
            onClick={proceedToConfirm}
            disabled={!dateOk || !athleteOk}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ----- STEP: CONFIRM -----
  if (step === 'confirm') {
    const valid = resolved.filter(r => r.athleteId && r.date);
    const unresolvedAthletes = mode === 'staff'
      ? resolved.filter(r => !r.athleteId && r.athleteName)
      : [];
    const noDate = resolved.filter(r => !r.date);
    const fieldsExtracted = new Set();
    resolved.forEach(r => {
      Object.keys(r).forEach(k => {
        if (!k.startsWith('_') && !['athleteId', 'athleteName', 'athleteResolved'].includes(k) && r[k] !== null && r[k] !== undefined) {
          fieldsExtracted.add(k);
        }
      });
    });

    return (
      <div style={styles.uploadCard}>
        <div style={styles.uploadHead}>
          <div>
            <div style={styles.uploadKicker}>Step 3 of 3</div>
            <div style={styles.uploadTitle}>Review and import</div>
          </div>
          <button onClick={onCancel} style={styles.uploadCancelX}><X size={16} /></button>
        </div>

        <div style={styles.uploadSummary}>
          <div style={styles.uploadSummaryCell}>
            <div style={styles.uploadSummaryLabel}>Ready</div>
            <div style={styles.uploadSummaryValue}>{valid.length}</div>
            <div style={styles.uploadSummarySub}>sessions</div>
          </div>
          {unresolvedAthletes.length > 0 && (
            <div style={{ ...styles.uploadSummaryCell, background: '#fdf5f0' }}>
              <div style={{ ...styles.uploadSummaryLabel, color: '#9c3a23' }}>Skipped</div>
              <div style={{ ...styles.uploadSummaryValue, color: '#9c3a23' }}>{unresolvedAthletes.length}</div>
              <div style={styles.uploadSummarySub}>name not matched</div>
            </div>
          )}
          {noDate.length > 0 && (
            <div style={{ ...styles.uploadSummaryCell, background: '#fdf5f0' }}>
              <div style={{ ...styles.uploadSummaryLabel, color: '#9c3a23' }}>Skipped</div>
              <div style={{ ...styles.uploadSummaryValue, color: '#9c3a23' }}>{noDate.length}</div>
              <div style={styles.uploadSummarySub}>no date</div>
            </div>
          )}
        </div>

        {unresolvedAthletes.length > 0 && (
          <div style={styles.uploadWarnPanel}>
            <div style={styles.uploadWarnTitle}>Athletes not found ({unresolvedAthletes.length})</div>
            <div style={styles.uploadWarnBody}>
              These names didn't match any athlete on the roster:
              <div style={{ marginTop: 6, fontWeight: 600, color: '#1a1a1a' }}>
                {[...new Set(unresolvedAthletes.map(r => r.athleteName))].slice(0, 8).join(', ')}
                {unresolvedAthletes.length > 8 && '…'}
              </div>
              <div style={{ marginTop: 8, fontSize: 11 }}>
                These rows will be skipped. Add player IDs to your roster or fix the names in the CSV.
              </div>
            </div>
          </div>
        )}

        <div style={styles.uploadFieldsPanel}>
          <div style={styles.uploadFieldsHead}>Metrics being imported</div>
          <div style={styles.uploadFieldsList}>
            {[...fieldsExtracted].filter(f => !['date', 'athleteId'].includes(f)).map(f => (
              <span key={f} style={styles.uploadFieldChip}>{f}</span>
            ))}
          </div>
        </div>

        <div style={styles.uploadOverwritePanel}>
          <div style={styles.uploadFieldsHead}>If a session already exists for this athlete + date</div>
          <div style={styles.perfBtnRow}>
            <button onClick={() => setOverwriteChoice('replace')}
              style={{ ...styles.perfPillBtn, ...(overwriteChoice === 'replace' ? styles.perfPillBtnActive : {}) }}>
              Replace
            </button>
            <button onClick={() => setOverwriteChoice('skip')}
              style={{ ...styles.perfPillBtn, ...(overwriteChoice === 'skip' ? styles.perfPillBtnActive : {}) }}>
              Skip
            </button>
            <button onClick={() => setOverwriteChoice('merge')}
              style={{ ...styles.perfPillBtn, ...(overwriteChoice === 'merge' ? styles.perfPillBtnActive : {}) }}>
              Merge fields
            </button>
          </div>
        </div>

        {/* Preview first 3 valid rows */}
        <div style={styles.uploadPreview}>
          <div style={styles.uploadFieldsHead}>Preview (first 3 rows)</div>
          {valid.slice(0, 3).map((r, i) => {
            const ath = athletes.find(a => a.id === r.athleteId);
            return (
              <div key={i} style={styles.uploadPreviewRow}>
                <div style={styles.uploadPreviewRowHead}>
                  <span style={styles.uploadPreviewRowName}>
                    {ath?.name || (mode === 'athlete' ? 'You' : r.athleteName)}
                  </span>
                  <span style={styles.uploadPreviewRowDate}>{r.date}</span>
                </div>
                <div style={styles.uploadPreviewRowMeta}>
                  {r.distanceM && `${(r.distanceM / 1000).toFixed(2)}km · `}
                  {r.playerLoad && `PL ${r.playerLoad} · `}
                  {r.maxVelocityMps && `max ${r.maxVelocityMps} m/s · `}
                  {r.avgHr && `avg HR ${r.avgHr}`}
                </div>
              </div>
            );
          })}
        </div>

        <div style={styles.uploadActions}>
          <button style={styles.perfCancelBtn} onClick={() => setStep('map')}>Back</button>
          <button
            style={{ ...styles.perfSaveBtn, opacity: valid.length > 0 ? 1 : 0.5 }}
            onClick={handleSave}
            disabled={valid.length === 0}
          >
            Import {valid.length} {valid.length === 1 ? 'session' : 'sessions'}
          </button>
        </div>
      </div>
    );
  }

  // ----- STEP: DONE -----
  if (step === 'done' && stats) {
    return (
      <div style={styles.uploadCard}>
        <div style={styles.uploadDoneIcon}>✓</div>
        <div style={styles.uploadDoneTitle}>{stats.imported} sessions imported</div>
        <div style={styles.uploadDoneBody}>
          Source: {stats.vendor}
          {stats.skipped > 0 && <div>{stats.skipped} rows skipped</div>}
        </div>

        <div style={styles.uploadActions}>
          <button style={styles.perfCancelBtn} onClick={resetAndStartOver}>Upload more</button>
          <button style={styles.perfSaveBtn} onClick={onCancel}>Done</button>
        </div>
      </div>
    );
  }

  return null;
}


function InjuryForm({ athleteId, onSave, onCancel }) {
  // Core
  const [bodyRegion, setBodyRegion] = useState(BODY_REGIONS[0]);
  const [side, setSide] = useState('Left');
  const [injuryType, setInjuryType] = useState(INJURY_TYPES[0]);
  const [mechanism, setMechanism] = useState(INJURY_MECHANISMS[0]);
  const [contactMechanism, setContactMechanism] = useState('Non-contact');
  const [activity, setActivity] = useState('Training');
  const [activityContext, setActivityContext] = useState('');
  const [severity, setSeverity] = useState(2);
  const [recurrence, setRecurrence] = useState('New (first occurrence)');
  const [priorInjuryRef, setPriorInjuryRef] = useState('');
  const [status, setStatus] = useState('modified');
  const [occurredOn, setOccurredOn] = useState(today());
  const [expectedDays, setExpectedDays] = useState(7);

  // Clinical
  const [diagnosis, setDiagnosis] = useState('');
  const [icd10, setIcd10] = useState('');
  const [osicsCode, setOsicsCode] = useState('');
  const [painScale, setPainScale] = useState(3);
  const [romLimitation, setRomLimitation] = useState('');

  // Imaging
  const [imaging, setImaging] = useState('None');
  const [imagingDate, setImagingDate] = useState('');
  const [imagingFindings, setImagingFindings] = useState('');

  // Plan
  const [treatment, setTreatment] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [prevention, setPrevention] = useState('');
  const [notes, setNotes] = useState('');

  // Section visibility (collapsible)
  const [openSection, setOpenSection] = useState('core'); // core | clinical | imaging | plan

  const handleSave = () => {
    const expectedRTP = (() => {
      const d = new Date(occurredOn);
      d.setDate(d.getDate() + Number(expectedDays));
      return d.toISOString().slice(0, 10);
    })();
    onSave({
      athleteId, bodyRegion, side, injuryType, mechanism,
      contactMechanism, activity, activityContext,
      severity: Number(severity), recurrence, priorInjuryRef: priorInjuryRef || null,
      status, occurredOn, expectedRTP, actualRTP: null,
      diagnosis, icd10: icd10 || null, osicsCode: osicsCode || null,
      painScale: Number(painScale), romLimitation: romLimitation || null,
      imaging, imagingDate: imagingDate || null, imagingFindings: imagingFindings || null,
      treatment, followUp: followUp || null, prevention: prevention || null,
      notes,
      rtpProgress: [],
      reportedBy: 'Dr. Patel'
    });
  };

  return (
    <div style={styles.perfFormCard}>
      <div style={styles.perfFormTitle}>Log injury</div>

      {/* Section: CORE */}
      <CollapsibleSection
        title="Injury details"
        kicker="REQUIRED"
        open={openSection === 'core'}
        onToggle={() => setOpenSection(openSection === 'core' ? null : 'core')}
      >
        <FormField label="Body region">
          <select style={styles.perfSelect} value={bodyRegion} onChange={e => setBodyRegion(e.target.value)}>
            {BODY_REGIONS.map(r => <option key={r}>{r}</option>)}
          </select>
        </FormField>

        <FormField label="Side">
          <div style={styles.perfBtnRow}>
            {['Left', 'Right', 'Bilateral', 'Central'].map(s => (
              <button key={s} onClick={() => setSide(s)}
                style={{ ...styles.perfPillBtn, ...(side === s ? styles.perfPillBtnActive : {}) }}>
                {s}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="Injury type">
          <select style={styles.perfSelect} value={injuryType} onChange={e => setInjuryType(e.target.value)}>
            {INJURY_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </FormField>

        <FormField label="Mechanism">
          <select style={styles.perfSelect} value={mechanism} onChange={e => setMechanism(e.target.value)}>
            {INJURY_MECHANISMS.map(m => <option key={m}>{m}</option>)}
          </select>
        </FormField>

        <FormField label="Contact mechanism">
          <div style={styles.perfBtnRow}>
            {['Contact', 'Non-contact', 'Indirect contact'].map(c => (
              <button key={c} onClick={() => setContactMechanism(c)}
                style={{ ...styles.perfPillBtn, ...(contactMechanism === c ? styles.perfPillBtnActive : {}) }}>
                {c}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="Activity at time of injury">
          <div style={styles.perfBtnRow}>
            {['Match', 'Training', 'Gym', 'Off-field', 'Other'].map(a => (
              <button key={a} onClick={() => setActivity(a)}
                style={{ ...styles.perfPillBtn, ...(activity === a ? styles.perfPillBtnActive : {}) }}>
                {a}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="Activity context (session, minute, drill)">
          <textarea style={styles.perfTextarea} rows="2" value={activityContext}
            onChange={e => setActivityContext(e.target.value)}
            placeholder="e.g. Round 6 vs Eastlake — sprinted for through-ball in 38th min" />
        </FormField>

        <FormField label="Severity (1=mild, 5=severe)">
          <div style={styles.perfBtnRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setSeverity(n)}
                style={{ ...styles.perfPillBtn, ...(severity === n ? styles.perfPillBtnActive : {}) }}>
                {n}
              </button>
            ))}
          </div>
        </FormField>

        <FormField label="Recurrence">
          <div style={styles.perfBtnRow}>
            {['New (first occurrence)', 'Recurrence (same site)', 'Re-aggravation', 'Related (different site)'].map(r => (
              <button key={r} onClick={() => setRecurrence(r)}
                style={{ ...styles.perfPillBtn, ...(recurrence === r ? styles.perfPillBtnActive : {}) }}>
                {r}
              </button>
            ))}
          </div>
        </FormField>

        {recurrence !== 'New (first occurrence)' && (
          <FormField label="Prior injury reference">
            <input style={styles.perfInput} value={priorInjuryRef}
              onChange={e => setPriorInjuryRef(e.target.value)}
              placeholder="e.g. L hamstring strain Apr 2024" />
          </FormField>
        )}

        <FormField label="Current status">
          <div style={styles.perfBtnRow}>
            <button onClick={() => setStatus('modified')}
              style={{ ...styles.perfPillBtn, ...(status === 'modified' ? styles.perfPillBtnActive : {}) }}>
              Modified
            </button>
            <button onClick={() => setStatus('unavailable')}
              style={{ ...styles.perfPillBtn, ...(status === 'unavailable' ? styles.perfPillBtnActive : {}) }}>
              Unavailable
            </button>
          </div>
        </FormField>

        <FormField label="Occurred on">
          <input type="date" style={styles.perfInput} value={occurredOn} onChange={e => setOccurredOn(e.target.value)} />
        </FormField>

        <FormField label="Expected RTP (days from injury)">
          <input type="number" min="0" max="365" style={styles.perfInput}
            value={expectedDays} onChange={e => setExpectedDays(e.target.value)} />
        </FormField>
      </CollapsibleSection>

      {/* Section: CLINICAL */}
      <CollapsibleSection
        title="Clinical findings"
        kicker="MEDICAL-RESTRICTED"
        open={openSection === 'clinical'}
        onToggle={() => setOpenSection(openSection === 'clinical' ? null : 'clinical')}
      >
        <FormField label="Diagnosis">
          <textarea style={styles.perfTextarea} rows="2" value={diagnosis}
            onChange={e => setDiagnosis(e.target.value)}
            placeholder="e.g. Grade 1 biceps femoris strain" />
        </FormField>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <FormField label="ICD-10 (optional)">
            <input style={styles.perfInput} value={icd10}
              onChange={e => setIcd10(e.target.value)} placeholder="S76.30" />
          </FormField>

          <FormField label="OSICS code (optional)">
            <input style={styles.perfInput} value={osicsCode}
              onChange={e => setOsicsCode(e.target.value)} placeholder="TPH1" />
          </FormField>
        </div>

        <FormField label={`Pain (0–10 NRS) · current: ${painScale}`}>
          <input type="range" min="0" max="10" value={painScale}
            onChange={e => setPainScale(e.target.value)}
            style={{ width: '100%' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8a8275' }}>
            <span>None</span><span>Severe</span>
          </div>
        </FormField>

        <FormField label="Range-of-motion limitation">
          <input style={styles.perfInput} value={romLimitation}
            onChange={e => setRomLimitation(e.target.value)}
            placeholder="e.g. 15° knee flexion deficit prone position" />
        </FormField>
      </CollapsibleSection>

      {/* Section: IMAGING */}
      <CollapsibleSection
        title="Imaging"
        kicker="OPTIONAL"
        open={openSection === 'imaging'}
        onToggle={() => setOpenSection(openSection === 'imaging' ? null : 'imaging')}
      >
        <FormField label="Imaging type">
          <div style={styles.perfBtnRow}>
            {['None', 'X-ray', 'MRI', 'CT', 'US', 'X-ray + MRI', 'Other'].map(m => (
              <button key={m} onClick={() => setImaging(m)}
                style={{ ...styles.perfPillBtn, ...(imaging === m ? styles.perfPillBtnActive : {}) }}>
                {m}
              </button>
            ))}
          </div>
        </FormField>

        {imaging !== 'None' && (
          <>
            <FormField label="Imaging date">
              <input type="date" style={styles.perfInput} value={imagingDate}
                onChange={e => setImagingDate(e.target.value)} />
            </FormField>

            <FormField label="Findings">
              <textarea style={styles.perfTextarea} rows="3" value={imagingFindings}
                onChange={e => setImagingFindings(e.target.value)}
                placeholder="e.g. Low-grade intramuscular oedema at long head of biceps femoris MTJ. No tendon avulsion." />
            </FormField>
          </>
        )}
      </CollapsibleSection>

      {/* Section: PLAN */}
      <CollapsibleSection
        title="Treatment plan"
        kicker="OPTIONAL"
        open={openSection === 'plan'}
        onToggle={() => setOpenSection(openSection === 'plan' ? null : 'plan')}
      >
        <FormField label="Treatment plan">
          <textarea style={styles.perfTextarea} rows="3" value={treatment}
            onChange={e => setTreatment(e.target.value)}
            placeholder="e.g. PEACE & LOVE. Manual therapy 2x/wk. Progressive loading day 7." />
        </FormField>

        <FormField label="Next follow-up">
          <input type="date" style={styles.perfInput} value={followUp}
            onChange={e => setFollowUp(e.target.value)} />
        </FormField>

        <FormField label="Prevention notes">
          <textarea style={styles.perfTextarea} rows="2" value={prevention}
            onChange={e => setPrevention(e.target.value)}
            placeholder="e.g. NHE program 3x/wk. Warm-up adjustments." />
        </FormField>

        <FormField label="Notes">
          <textarea style={styles.perfTextarea} rows="2" value={notes}
            onChange={e => setNotes(e.target.value)} placeholder="Optional" />
        </FormField>
      </CollapsibleSection>

      <div style={styles.perfFormActions}>
        <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
        <button style={styles.perfSaveBtn} onClick={handleSave}>Save injury</button>
      </div>
    </div>
  );
}

function CollapsibleSection({ title, kicker, open, onToggle, children }) {
  return (
    <div style={styles.collapseSection}>
      <button onClick={onToggle} style={styles.collapseHead}>
        <div>
          {kicker && <div style={styles.collapseKicker}>{kicker}</div>}
          <div style={styles.collapseTitle}>{title}</div>
        </div>
        <ChevronRight
          size={16}
          color="#8a8275"
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
        />
      </button>
      {open && (
        <div style={styles.collapseBody}>
          {children}
        </div>
      )}
    </div>
  );
}



function TestForm({ athleteId, onSave, onCancel }) {
  const [testKey, setTestKey] = useState('cmj');
  const [category, setCategory] = useState('Power');
  const [date, setDate] = useState(today());
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [customName, setCustomName] = useState('');
  const [customUnit, setCustomUnit] = useState('');

  const meta = getTest(testKey);
  const testsInCat = TEST_CATALOG.filter(t => t.cat === category);

  const handleSave = () => {
    if (!value && testKey !== 'custom') return;
    onSave({
      athleteId,
      testKey,
      date,
      value: typeof value === 'string' && !isNaN(Number(value)) ? Number(value) : value,
      notes,
      enteredBy: 'A. Reeves',
      ...(testKey === 'custom' ? { customName, customUnit } : {})
    });
  };

  return (
    <div style={styles.perfFormCard}>
      <div style={styles.perfFormTitle}>Record test result</div>

      <FormField label="Category">
        <div style={styles.perfBtnRow}>
          {TEST_CATEGORIES.map(c => (
            <button key={c} onClick={() => {
              setCategory(c);
              const first = TEST_CATALOG.find(t => t.cat === c);
              if (first) setTestKey(first.key);
            }}
            style={{ ...styles.perfPillBtn, ...(category === c ? styles.perfPillBtnActive : {}) }}>
              {c}
            </button>
          ))}
        </div>
      </FormField>

      <FormField label="Test">
        <select style={styles.perfSelect} value={testKey} onChange={e => setTestKey(e.target.value)}>
          {testsInCat.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
        </select>
        <div style={{ fontSize: 11, color: '#8a8275', marginTop: 6, lineHeight: 1.4 }}>
          {meta.brief}
        </div>
      </FormField>

      {testKey === 'custom' && (
        <>
          <FormField label="Test name">
            <input style={styles.perfInput} value={customName} onChange={e => setCustomName(e.target.value)} placeholder="e.g. Single-leg hop test" />
          </FormField>
          <FormField label="Unit">
            <input style={styles.perfInput} value={customUnit} onChange={e => setCustomUnit(e.target.value)} placeholder="e.g. cm, s, reps" />
          </FormField>
        </>
      )}

      <FormField label={`Result${testKey !== 'custom' ? ` (${meta.unit})` : ''}`}>
        <input
          style={styles.perfInput}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={meta.unit === 'mm:ss' ? '6:42' : 'e.g. 42.5'}
        />
        {meta.better === 'lower' && <div style={{ fontSize: 11, color: '#8a8275', marginTop: 4 }}>Lower is better</div>}
        {meta.better === 'higher' && <div style={{ fontSize: 11, color: '#8a8275', marginTop: 4 }}>Higher is better</div>}
      </FormField>

      <FormField label="Date">
        <input type="date" style={styles.perfInput} value={date} onChange={e => setDate(e.target.value)} />
      </FormField>

      <FormField label="Notes">
        <textarea style={styles.perfTextarea} rows="2" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
      </FormField>

      <div style={styles.perfFormActions}>
        <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
        <button style={styles.perfSaveBtn} onClick={handleSave}>Save result</button>
      </div>
    </div>
  );
}

function BaselineForm({ athleteId, existing, onSave, onCancel }) {
  const [date, setDate] = useState(existing?.date || today());
  const [symptomScore, setSymptomScore] = useState(existing?.symptomScore || 0);
  const [symptomSeverity, setSymptomSeverity] = useState(existing?.symptomSeverity || 0);
  const [orientationScore, setOrientationScore] = useState(existing?.orientationScore || 5);
  const [immediateMemory, setImmediateMemory] = useState(existing?.immediateMemory || 10);
  const [delayedMemory, setDelayedMemory] = useState(existing?.delayedMemory || 10);
  const [concentration, setConcentration] = useState(existing?.concentration || 5);
  const [mBESS, setMBESS] = useState(existing?.mBESS || 0);
  const [tandemGait, setTandemGait] = useState(existing?.tandemGait || 12);
  const [previousConcussions, setPreviousConcussions] = useState(existing?.previousConcussions || 0);
  const [notes, setNotes] = useState(existing?.notes || '');

  const handleSave = () => {
    onSave({
      athleteId, date,
      symptomScore: Number(symptomScore), symptomSeverity: Number(symptomSeverity),
      orientationScore: Number(orientationScore), immediateMemory: Number(immediateMemory),
      delayedMemory: Number(delayedMemory), concentration: Number(concentration),
      mBESS: Number(mBESS), tandemGait: Number(tandemGait),
      previousConcussions: Number(previousConcussions),
      notes, administeredBy: 'Dr. Patel'
    });
  };

  return (
    <div style={styles.perfFormCard}>
      <div style={styles.perfFormTitle}>
        {existing ? 'Update' : 'Record'} concussion baseline (SCAT6)
      </div>

      <div style={{ fontSize: 11, color: '#8a8275', marginBottom: 14, lineHeight: 1.5 }}>
        Recommended for athletes 13+. Annual recording. SCAT6 cannot be used to diagnose concussion in isolation — it's a baseline reference for post-injury comparison.
      </div>

      <FormField label="Date administered">
        <input type="date" style={styles.perfInput} value={date} onChange={e => setDate(e.target.value)} />
      </FormField>

      <div style={styles.baselineGrid}>
        <NumField label="Symptom score (0–132)" value={symptomScore} onChange={setSymptomScore} max="132" />
        <NumField label="Symptom severity (0–132)" value={symptomSeverity} onChange={setSymptomSeverity} max="132" />
        <NumField label="Orientation /5" value={orientationScore} onChange={setOrientationScore} max="5" />
        <NumField label="Immediate memory /10" value={immediateMemory} onChange={setImmediateMemory} max="10" />
        <NumField label="Delayed memory /10" value={delayedMemory} onChange={setDelayedMemory} max="10" />
        <NumField label="Concentration /5" value={concentration} onChange={setConcentration} max="5" />
        <NumField label="mBESS errors /30" value={mBESS} onChange={setMBESS} max="30" />
        <NumField label="Tandem gait (s)" value={tandemGait} onChange={setTandemGait} step="0.1" />
      </div>

      <FormField label="Previous concussions">
        <input type="number" min="0" max="20" style={styles.perfInput}
          value={previousConcussions} onChange={e => setPreviousConcussions(e.target.value)} />
      </FormField>

      <FormField label="Notes">
        <textarea style={styles.perfTextarea} rows="2" value={notes} onChange={e => setNotes(e.target.value)} />
      </FormField>

      <div style={styles.perfFormActions}>
        <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
        <button style={styles.perfSaveBtn} onClick={handleSave}>Save baseline</button>
      </div>
    </div>
  );
}

function FileForm({ athleteId, onSave, onCancel }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('screening');
  const [sizeKb, setSizeKb] = useState(0);
  const fileInputRef = React.useRef(null);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setName(f.name);
      setSizeKb(Math.round(f.size / 1024));
    }
  };

  const handleSave = () => {
    if (!name) return;
    onSave({
      athleteId, name, type, sizeKb,
      uploadedBy: 'A. Reeves',
      uploadedByRole: 'staff',
      sharedWithStaff: true
    });
  };

  return (
    <div style={styles.perfFormCard}>
      <div style={styles.perfFormTitle}>Add file</div>

      <div style={{ fontSize: 11, color: '#8a8275', marginBottom: 14, lineHeight: 1.5 }}>
        Demo mode — files are stored as metadata only (name, type, date). Real uploads will be wired to secure storage.
      </div>

      <FormField label="Choose file">
        <input type="file" ref={fileInputRef} onChange={handleFileChange}
          style={{ fontFamily: 'inherit', fontSize: 13 }} />
      </FormField>

      {!name && (
        <FormField label="Or enter file name manually">
          <input style={styles.perfInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Pre-season screening.pdf" />
        </FormField>
      )}

      <FormField label="Type">
        <select style={styles.perfSelect} value={type} onChange={e => setType(e.target.value)}>
          <option value="screening">Screening</option>
          <option value="imaging">Imaging</option>
          <option value="assessment">Assessment</option>
          <option value="concussion">Concussion</option>
          <option value="questionnaire">Questionnaire</option>
          <option value="other">Other</option>
        </select>
      </FormField>

      <div style={styles.perfFormActions}>
        <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
        <button style={styles.perfSaveBtn} onClick={handleSave} disabled={!name}>
          Save file
        </button>
      </div>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div style={styles.perfFormField}>
      <div style={styles.perfFormLabel}>{label}</div>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange, max, step }) {
  return (
    <div>
      <div style={styles.baselineLabel}>{label}</div>
      <input
        type="number"
        min="0"
        max={max}
        step={step || 1}
        style={styles.perfNumInput}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function flagExplain(f, row) {
  switch (f.type) {
    case 'load': return `Acute:chronic workload ratio is ${row.acwr.toFixed(2)} — workload has increased sharply versus the 28-day baseline.`;
    case 'monotony': return `Monotony index ${row.mon.toFixed(2)} — training week shows little variation in daily load.`;
    case 'wellness': return `Wellness average ${row.wellAvg.toFixed(1)}/7 over last 7 days — subjective recovery markers are elevated.`;
    case 'missing': return `Last session was ${row.dayssince} days ago — data may be incomplete.`;
    case 'compliance': return `Fewer than 3 wellness check-ins in the last week — adherence is low.`;
    default: return f.label;
  }
}

function DetailStat({ label, value, unit, warn }) {
  return (
    <div style={styles.detailStat}>
      <div style={styles.detailStatLabel}>{label}</div>
      <div style={{ ...styles.detailStatVal, color: warn ? '#c8472b' : '#1a1a1a' }}>
        {value}{unit && <span style={styles.detailStatUnit}>{unit}</span>}
      </div>
    </div>
  );
}

function ChartBars({ data, height = 120 }) {
  const max = Math.max(...data.map(d => d.load), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, paddingTop: 8 }}>
      {data.map((d, i) => {
        const h = (d.load / max) * (height - 20);
        const dt = new Date(d.date);
        const isMonday = dt.getDay() === 1;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: '100%',
              height: Math.max(h, 1),
              background: d.load > 0 ? '#1a1a1a' : '#e8e4dc',
              borderRadius: 1
            }} />
            <span style={{ fontSize: 8, color: '#8a8275', height: 10 }}>
              {isMonday ? fmtShort(d.date).split(' ')[0] : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WellnessChart({ data, height = 100 }) {
  const w = 600;
  const padding = 8;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (w - padding * 2) + padding;
    const y = d.score !== null ? height - (d.score / 7) * (height - 16) - 8 : null;
    return { x, y, score: d.score, date: d.date };
  });
  const validPts = pts.filter(p => p.y !== null);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: 'block' }}>
      {/* threshold line at 4 */}
      <line x1={padding} x2={w - padding} y1={height - (4 / 7) * (height - 16) - 8} y2={height - (4 / 7) * (height - 16) - 8}
        stroke="#e0d9c8" strokeWidth="1" strokeDasharray="3 3" />
      <text x={w - padding} y={height - (4 / 7) * (height - 16) - 12} fontSize="9" fill="#b8b1a0" textAnchor="end">strained</text>

      {validPts.length > 1 && (
        <polyline
          points={validPts.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="#1a1a1a" strokeWidth="1.5"
        />
      )}
      {pts.map((p, i) => p.y !== null && (
        <circle key={i} cx={p.x} cy={p.y} r="2" fill={p.score > 4 ? '#c8472b' : '#1a1a1a'} />
      ))}
    </svg>
  );
}

// ============================================================
// FeedbackWidget — floating button + form for tester feedback
// Always present. Submits via mailto: so testers don't need backend.
// ============================================================
function FeedbackWidget({ currentUser }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(null);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const categories = [
    { k: 'confusing',    l: 'Something was confusing',  emoji: '?' },
    { k: 'missing',      l: 'Something is missing',     emoji: '＋' },
    { k: 'broken',       l: "Something doesn't work",   emoji: '!' },
    { k: 'idea',         l: 'I have an idea',           emoji: '◇' },
    { k: 'general',      l: 'General comment',          emoji: '◌' }
  ];

  const [copied, setCopied] = useState(false);

  const handleSend = () => {
    const cat = categories.find(c => c.k === category);
    const subject = `Tempo feedback: ${cat?.l || 'comment'}`;
    const context = currentUser
      ? `\n\n— sent while signed in as ${currentUser.name} (${currentUser.role})`
      : '\n\n— sent from the login screen';
    const body = `${message}${context}\n\nDemo version: ${DEMO_VERSION}\nURL: ${typeof window !== 'undefined' ? window.location.href : ''}`;

    // Always copy to clipboard so testers have a fallback
    const clipboardText = `To: ${FEEDBACK_EMAIL}\nSubject: ${subject}\n\n${body}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(clipboardText);
        setCopied(true);
      }
    } catch {
      // Some browsers (older Safari, embedded contexts) reject clipboard writes.
      // We still try mailto: below — at minimum that's a path forward.
    }

    // Try to open the mail app as a convenience
    const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try { window.location.href = mailto; } catch {}

    setSent(true);
    // Reset after a beat
    setTimeout(() => {
      setOpen(false);
      setSent(false);
      setCopied(false);
      setCategory(null);
      setMessage('');
    }, 3500);
  };

  const close = () => {
    setOpen(false);
    setCategory(null);
    setMessage('');
    setSent(false);
    setCopied(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={styles.feedbackFloater}
        aria-label="Send feedback"
      >
        <span style={styles.feedbackFloaterText}>Feedback</span>
      </button>

      {open && (
        <div style={styles.feedbackBackdrop} onClick={close}>
          <div style={styles.feedbackSheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.userSheetGrip} />

            {sent ? (
              <div style={styles.feedbackSent}>
                <div style={styles.feedbackSentIcon}>✓</div>
                <div style={styles.feedbackSentTitle}>Thanks</div>
                {copied ? (
                  <>
                    <div style={styles.feedbackSentText}>
                      Copied to your clipboard. If your email app didn't open, paste it into a new message to:
                    </div>
                    <div style={styles.feedbackEmailChip}>{FEEDBACK_EMAIL}</div>
                  </>
                ) : (
                  <>
                    <div style={styles.feedbackSentText}>
                      If your email app didn't open, please send your feedback directly to:
                    </div>
                    <div style={styles.feedbackEmailChip}>{FEEDBACK_EMAIL}</div>
                  </>
                )}
              </div>
            ) : (
              <div style={styles.feedbackBody}>
                <div style={styles.feedbackHead}>
                  <div>
                    <div style={styles.feedbackTitle}>Send feedback</div>
                    <div style={styles.feedbackSubtitle}>
                      Anything confusing, missing, or off? Let me know.
                    </div>
                  </div>
                  <button
                    onClick={close}
                    style={styles.userSheetClose}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div style={styles.feedbackCatLabel}>What kind of feedback?</div>
                <div style={styles.feedbackCatGrid}>
                  {categories.map(c => (
                    <button
                      key={c.k}
                      onClick={() => setCategory(c.k)}
                      style={{
                        ...styles.feedbackCatBtn,
                        ...(category === c.k ? styles.feedbackCatBtnActive : {})
                      }}
                    >
                      <span style={styles.feedbackCatEmoji}>{c.emoji}</span>
                      <span style={styles.feedbackCatLabelInner}>{c.l}</span>
                    </button>
                  ))}
                </div>

                <div style={styles.feedbackCatLabel}>Tell me more</div>
                <textarea
                  style={styles.feedbackTextarea}
                  rows="4"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={
                    category === 'confusing' ? "What confused you? Where were you in the app?" :
                    category === 'missing'   ? "What were you trying to do?" :
                    category === 'broken'    ? "What did you tap? What did you expect to happen?" :
                    category === 'idea'      ? "What's the idea? What problem would it solve?" :
                                              "Whatever's on your mind."
                  }
                />

                <button
                  onClick={handleSend}
                  disabled={!category || !message.trim()}
                  style={{
                    ...styles.feedbackSendBtn,
                    opacity: (category && message.trim()) ? 1 : 0.4
                  }}
                >
                  Send feedback
                </button>

                <p style={styles.feedbackNote}>
                  Copies to your clipboard and tries to open your email app. If email doesn't open, paste into a new message to {FEEDBACK_EMAIL}.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}


// ============================================================
// Athlete profile setup — shown to a real athlete-role user on first login,
// before they have an `athletes` row (M3). Creates the profile + self link.
// Kept intentionally short (name, position, sport required) to stay calm;
// fuller profile detail is editable later in the app.
// ============================================================
function AthleteProfileSetup({ currentUser, onCreated, onLogout }) {
  const [name, setName] = useState(currentUser?.name || '');
  const [position, setPosition] = useState('');
  const [sport, setSport] = useState('');
  const [team, setTeam] = useState('');
  const [squad, setSquad] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const canSave = name.trim() && position.trim() && sport.trim();

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (!canSave) { setError('Name, position and sport are required.'); return; }
    setBusy(true);
    try {
      const athlete = await createAthlete(
        { displayName: name, position, sport, team, squad },
        currentUser.id
      );
      onCreated(athlete);
    } catch (err) {
      console.error('createAthlete', err);
      setError('Could not create your profile. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div style={styles.loginFrame}>
      <div style={styles.loginInner}>
        <div style={styles.loginMark}>◐</div>
        <div style={styles.loginBrand}>tempo</div>
        <div style={styles.loginTagline}>Set up your athlete profile</div>

        <form onSubmit={handleSubmit} style={styles.loginForm}>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Name</label>
            <input style={styles.loginInput} value={name}
              onChange={e => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Position</label>
            <input style={styles.loginInput} value={position}
              onChange={e => setPosition(e.target.value)} placeholder="e.g. Forward" />
          </div>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Sport</label>
            <input style={styles.loginInput} value={sport}
              onChange={e => setSport(e.target.value)} placeholder="e.g. Football" />
          </div>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Team <span style={{ opacity: 0.5 }}>(optional)</span></label>
            <input style={styles.loginInput} value={team}
              onChange={e => setTeam(e.target.value)} placeholder="e.g. Marlborough FC" />
          </div>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Squad <span style={{ opacity: 0.5 }}>(optional)</span></label>
            <input style={styles.loginInput} value={squad}
              onChange={e => setSquad(e.target.value)} placeholder="e.g. Seniors" />
          </div>

          {error && <div style={styles.loginError}>{error}</div>}

          <button type="submit"
            style={{ ...styles.loginSubmit, opacity: (!canSave || busy) ? 0.6 : 1 }}
            disabled={!canSave || busy}>
            {busy ? 'Creating…' : 'Create profile'}
          </button>

          <div style={styles.loginLinks}>
            <a style={styles.loginLink} onClick={onLogout}>Log out</a>
          </div>
        </form>

        <div style={styles.loginFoot}>
          This is your own athlete profile. You can add more detail later.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ROOT
// ============================================================
export default function App() {
  const [introSeen, setIntroSeen] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [mode, setMode] = useState(null); // null until login | 'athlete' | 'practitioner'
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [session, setSession] = useState(null);   // real Supabase session (gates the app)
  const [authChecked, setAuthChecked] = useState(false); // session resolved on load yet?
  const [auditLog, setAuditLog] = useState([]);
  // Real athlete's own DB profile (M3). Resolved for athlete-role users who came
  // from a real session (i.e. no demo persona athleteId). null = none yet → setup.
  const [myAthlete, setMyAthlete] = useState(null);
  const [athleteChecked, setAthleteChecked] = useState(false);

  // Build the current-user object from the REAL authenticated session. Sign-up
  // stores display_name / default_role / title in the auth user's metadata, so we
  // can derive identity synchronously without an async profile fetch (matches the
  // brief's rule: route off session metadata, never block on the profiles row).
  // The in-app switcher + view toggle still let you move between athlete and
  // practitioner freely afterward; this only sets the *initial* identity + view.
  //
  // NOTE: the app body below is still seed-backed in M1 — only the identity (name,
  // role, title) is real. A real athlete has no athleteId yet, so its seed body is
  // empty until M3 brings in real athlete/profile data. The demo IdentitySwitcher
  // stays in the code as a manual escape hatch but no longer drives this default.
  const realUserFromSession = (sess) => {
    const u = sess.user || {};
    const meta = u.user_metadata || {};
    const isAthlete = meta.default_role === 'athlete';
    const name = (meta.display_name || '').trim() || u.email || 'You';
    const initials =
      name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() ||
      (u.email || '?').slice(0, 2).toUpperCase();
    return {
      id: u.id,
      name,
      email: u.email || '',
      role: isAthlete ? 'athlete' : 'practitioner',
      title: (meta.title || '').trim(),
      isStaff: !isAthlete,
      avatar: initials,
      // No athleteId: real athlete data arrives in M3. Until then an athlete-role
      // user simply has no seed-backed body to drive.
    };
  };

  // Reconcile React state with the real auth session. Called on initial load and
  // on every auth change (sign-in, sign-out, token refresh).
  const applySession = (sess) => {
    setSession(sess);
    if (!sess) {
      setCurrentUser(null);
      setMode(null);
      return;
    }
    setIntroSeen(true); // a returning, logged-in user skips the landing splash
    const realUser = realUserFromSession(sess);
    // Only set the identity/view if one isn't already chosen — never clobber a
    // mid-session identity switch or view toggle on a token refresh.
    setCurrentUser(prev => prev ?? realUser);
    setMode(prev => prev ?? realUser.role);
  };

  useEffect(() => {
    const seed = getSeedData();
    setAuditLog(seed.teamAuditLog || []);
    setIntroSeen(false);

    let active = true;
    getSession().then(sess => {
      if (!active) return;
      applySession(sess);
      setAuthChecked(true);
    });
    const { data: sub } = onAuthStateChange(sess => {
      if (!active) return;
      applySession(sess);
      setAuthChecked(true);
    });
    return () => { active = false; sub?.subscription?.unsubscribe(); };
  }, []);

  // Resolve the real athlete's own profile once identity is known. Skipped for
  // staff and for demo personas (which carry a seed athleteId and stay in-memory).
  useEffect(() => {
    const u = currentUser;
    const isRealAthlete = !!u && u.role === 'athlete' && !u.athleteId;
    if (!isRealAthlete) {
      setMyAthlete(null);
      setAthleteChecked(true);
      return;
    }
    let active = true;
    setAthleteChecked(false);
    getMyAthlete(u.id)
      .then(a => { if (active) { setMyAthlete(a); setAthleteChecked(true); } })
      .catch(() => { if (active) { setMyAthlete(null); setAthleteChecked(true); } });
    return () => { active = false; };
  }, [currentUser?.id, currentUser?.role, currentUser?.athleteId]);

  const dismissIntro = () => {
    setIntroSeen(true);
  };

  // Used by the in-app IdentitySwitcher to switch which demo identity drives the
  // body within an active session. Auth is unchanged — this is view/identity only.
  const handleLogin = (user) => {
    setCurrentUser(user);
    if (user.isStaff) {
      setMode('practitioner');
    } else {
      setMode('athlete');
    }
  };

  const handleLogout = async () => {
    await signOut();
    // The auth listener clears session/currentUser/mode; clear locally too so the
    // UI updates immediately even before the event lands.
    setCurrentUser(null);
    setMode(null);
  };

  // Audit recorder — passed down so any sensitive view can log itself
  const recordAudit = (action, athleteId, detail) => {
    if (!currentUser) return;
    const entry = {
      id: `au_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      occurredAt: new Date().toISOString(),
      actorUserId: currentUser.id,
      athleteId,
      action,
      detail: detail || ''
    };
    setAuditLog(prev => [entry, ...prev]);
  };

  if (introSeen === null) {
    return <div style={styles.root}><style>{globalCSS}</style></div>;
  }

  if (!introSeen) {
    return (
      <div style={styles.root}>
        <style>{globalCSS}</style>
        <IntroScreen onContinue={dismissIntro} />
      </div>
    );
  }

  // Wait for the session to resolve on load before deciding what to show, so a
  // persisted session doesn't flash the login screen.
  if (!authChecked) {
    return <div style={styles.root}><style>{globalCSS}</style></div>;
  }

  // Real auth gate: no session → login / signup. A persisted session skips this.
  if (!session) {
    return (
      <div style={styles.root}>
        <style>{globalCSS}</style>
        <LoginScreen />
        <FeedbackWidget currentUser={null} />
      </div>
    );
  }

  // Session exists but the demo identity hasn't been seeded yet (brief moment).
  if (!currentUser) {
    return <div style={styles.root}><style>{globalCSS}</style></div>;
  }

  // For demos: an athlete user can switch which athlete profile to view
  // (only relevant if currentUser.role === 'athlete'). The switcher also
  // lets staff users jump between roles to see how access changes.
  const demoAthleteId = currentUser.role === 'athlete' ? currentUser.athleteId : null;
  // A real athlete-role user with no demo persona id is DB-backed (M3).
  const isRealAthlete = currentUser.role === 'athlete' && !currentUser.athleteId;

  return (
    <div style={styles.root}>
      <style>{globalCSS}</style>
      {showSwitcher && (
        <IdentitySwitcher
          currentUserId={currentUser.id}
          onPick={handleLogin}
          onClose={() => setShowSwitcher(false)}
        />
      )}
      {mode === 'athlete' && isRealAthlete && !athleteChecked && (
        // Resolving the real athlete's profile — brief blank to avoid a flash.
        <div style={styles.root} />
      )}
      {mode === 'athlete' && isRealAthlete && athleteChecked && !myAthlete && (
        <AthleteProfileSetup
          currentUser={currentUser}
          onCreated={(athlete) => setMyAthlete(athlete)}
          onLogout={handleLogout}
        />
      )}
      {mode === 'athlete' && (!isRealAthlete || (athleteChecked && myAthlete)) && (
        <AthleteApp
          currentUser={currentUser}
          demoAthleteId={demoAthleteId}
          realAthlete={isRealAthlete ? myAthlete : null}
          auditLog={auditLog}
          recordAudit={recordAudit}
          onSwitchView={() => currentUser.isStaff && setMode('practitioner')}
          onOpenSwitcher={() => setShowSwitcher(true)}
          onLogout={handleLogout}
        />
      )}
      {mode === 'practitioner' && (
        <PractitionerApp
          currentUser={currentUser}
          auditLog={auditLog}
          recordAudit={recordAudit}
          onSwitchView={() => setMode('athlete')}
          onOpenSwitcher={() => setShowSwitcher(true)}
          onLogout={handleLogout}
        />
      )}
      <FeedbackWidget currentUser={currentUser} />
    </div>
  );
}

// ============================================================
// Intro screen — landing page for testers
// ============================================================
function IntroScreen({ onContinue }) {
  return (
    <div style={styles.introFrame}>
      <div style={styles.introInner}>
        {/* Brand */}
        <div style={styles.introBrandRow}>
          <div style={styles.introMark}>◐</div>
          <div style={styles.introBrand}>tempo</div>
        </div>

        {/* One-liner */}
        <h1 style={styles.introHeadline}>
          Training load monitoring for athletes and the people helping them.
        </h1>

        <p style={styles.introSubhead}>
          A calm daily check-in for athletes, a clear caseload view for coaches and clinicians,
          and consent-first sharing between them.
        </p>

        {/* Who it's for */}
        <div style={styles.introWhoCard}>
          <div style={styles.introWhoLabel}>For</div>
          <div style={styles.introWhoList}>
            <div style={styles.introWhoItem}>
              <span style={styles.introWhoIcon}>↑</span>
              <span style={styles.introWhoText}>
                <strong>Recreational athletes</strong> — runners, cyclists, gym, hybrid, team sport
              </span>
            </div>
            <div style={styles.introWhoItem}>
              <span style={styles.introWhoIcon}>◆</span>
              <span style={styles.introWhoText}>
                <strong>Coaches</strong> — S&C, head coaches, personal trainers
              </span>
            </div>
            <div style={styles.introWhoItem}>
              <span style={styles.introWhoIcon}>＋</span>
              <span style={styles.introWhoText}>
                <strong>Clinicians</strong> — physios, sports doctors, allied health
              </span>
            </div>
            <div style={styles.introWhoItem}>
              <span style={styles.introWhoIcon}>◇</span>
              <span style={styles.introWhoText}>
                <strong>Clubs</strong> — single team, multi-squad, or full organisations
              </span>
            </div>
          </div>
        </div>

        {/* Demo notice */}
        <div style={styles.introDemoBox}>
          <div style={styles.introDemoLabel}>You're seeing the demo</div>
          <p style={styles.introDemoText}>
            Nothing you do is saved. Reload to start fresh. Sign in as a seeded user to see
            populated data, or create a new account to experience signup.
          </p>
        </div>

        {/* CTA */}
        <button style={styles.introCta} onClick={onContinue}>
          Open Tempo
        </button>

        <div style={styles.introFoot}>
          Prototype · v0.4 · Feedback welcome
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LoginScreen — real-looking login with demo-mode shortcut
// ============================================================
// ============================================================
// SignupFlow — onboarding for new independent athletes
// Three-step flow: identity → sport → welcome
// ============================================================
function SignupFlow({ onComplete, onCancel }) {
  const [step, setStep] = useState('who'); // who | identity | sport | role | welcome
  const [accountType, setAccountType] = useState(null); // 'athlete' | 'staff'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sport, setSport] = useState(null);
  const [staffRole, setStaffRole] = useState(null);
  const [staffTitle, setStaffTitle] = useState('');
  const [emailError, setEmailError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [busy, setBusy] = useState(false);

  const sports = [
    { k: 'running',       l: 'Running',                     desc: 'Road, trail, ultra, marathon', icon: '↑' },
    { k: 'cycling',       l: 'Cycling',                     desc: 'Road, MTB, gravel, indoor',   icon: '◯' },
    { k: 'strength',      l: 'Strength training',           desc: 'Gym, powerlifting, CrossFit', icon: '▣' },
    { k: 'hybrid',        l: 'Hybrid training',             desc: 'Mix of strength + endurance', icon: '◐' },
    { k: 'triathlon',     l: 'Triathlon / multisport',      desc: 'Swim, bike, run combined',    icon: '△' },
    { k: 'team',          l: 'Team sport',                  desc: 'Football, rugby, hockey, etc.', icon: '◆' },
    { k: 'other',         l: 'Other / general',             desc: 'Mixed training, fitness',     icon: '○' }
  ];

  const staffRoles = [
    { k: 'sc_coach',   l: 'S&C Coach / Trainer',          desc: 'Strength & conditioning, personal trainer',
      titlePlaceholder: 'e.g. Head of S&C' },
    { k: 'head_coach', l: 'Coach',                        desc: 'Sport-specific coach, head coach, assistant',
      titlePlaceholder: 'e.g. Head Coach' },
    { k: 'physio',     l: 'Physio / Clinician',           desc: 'Physiotherapist, sports doctor, chiropractor',
      titlePlaceholder: 'e.g. Sports Physiotherapist' },
    { k: 'consultant', l: 'Consultant / External support', desc: 'Sports scientist, advisor, specialist',
      titlePlaceholder: 'e.g. Sports Scientist' },
    { k: 'club_admin', l: 'Club / Team administrator',    desc: 'Manages team rosters and access',
      titlePlaceholder: 'e.g. Operations Manager' }
  ];

  const handleIdentityNext = () => {
    setEmailError(null);
    if (!name.trim()) return;
    if (!email.trim() || !/^.+@.+\..+/.test(email)) {
      setEmailError('Enter a valid email.');
      return;
    }
    if (!password || password.length < 6) {
      setEmailError('Password must be at least 6 characters.');
      return;
    }
    // Email uniqueness is enforced by Supabase Auth at signup (handleFinish).
    setStep(accountType === 'staff' ? 'role' : 'sport');
  };

  const handleFinish = async () => {
    setSubmitError(null);
    const defaultRole = accountType === 'staff' ? 'practitioner' : 'athlete';
    const roleInfo = staffRoles.find(r => r.k === staffRole);
    const title = accountType === 'staff' ? (staffTitle.trim() || roleInfo?.l || '') : '';

    setBusy(true);
    const { data, error: authError } = await signUp({
      email: email.trim().toLowerCase(),
      password,
      displayName: name.trim(),
      defaultRole,
      title,
    });
    setBusy(false);

    if (authError) {
      setSubmitError(authError.message);
      return;
    }
    // With email confirmation disabled (pilot), signUp returns an active session
    // and the App-level auth listener routes in. If there's no session, the
    // dashboard still has "Confirm email" enabled.
    if (!data?.session) {
      setSubmitError(
        'Account created, but a confirmation step is enabled. Disable "Confirm email" in ' +
        'Supabase → Authentication → Providers → Email, then sign in.'
      );
      return;
    }
    onComplete?.();
  };

  // ===== STEP: IDENTITY =====
  // ===== STEP: WHO =====
  if (step === 'who') {
    return (
      <div style={styles.loginFrame}>
        <div style={styles.loginInner}>
          <div style={styles.signupStep}>Step 1 of 4</div>
          <h1 style={styles.signupTitle}>Welcome to Tempo</h1>
          <p style={styles.signupIntro}>
            Let's get you set up. First — are you signing up as an athlete tracking your own training,
            or as a coach, clinician, or other support person?
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={() => setAccountType('athlete')}
              style={{
                ...styles.signupSportBtn,
                ...(accountType === 'athlete' ? styles.signupSportBtnActive : {})
              }}
            >
              <span style={styles.signupSportIcon}>◐</span>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={styles.signupSportLabel}>I'm an athlete</div>
                <div style={styles.signupSportDesc}>Track my training, monitor wellness, invite support staff</div>
              </div>
            </button>

            <button
              onClick={() => setAccountType('staff')}
              style={{
                ...styles.signupSportBtn,
                ...(accountType === 'staff' ? styles.signupSportBtnActive : {})
              }}
            >
              <span style={styles.signupSportIcon}>◆</span>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={styles.signupSportLabel}>I'm a coach or clinician</div>
                <div style={styles.signupSportDesc}>Work with athletes, manage caseload, leave notes</div>
              </div>
            </button>
          </div>

          <div style={styles.signupActions}>
            <button style={styles.perfCancelBtn} onClick={onCancel}>Cancel</button>
            <button
              style={{ ...styles.loginSubmit, flex: 1, opacity: accountType ? 1 : 0.4 }}
              disabled={!accountType}
              onClick={() => setStep('identity')}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'identity') {
    return (
      <div style={styles.loginFrame}>
        <div style={styles.loginInner}>
          <div style={styles.signupStep}>Step 2 of 4</div>
          <h1 style={styles.signupTitle}>
            {accountType === 'staff' ? 'Tell us about yourself' : 'Welcome to Tempo'}
          </h1>
          <p style={styles.signupIntro}>
            {accountType === 'staff'
              ? 'Just a few details to set up your account. You can add more later.'
              : 'Track your training, monitor your wellness, and share your data with the people helping you. Just a couple of details to get started.'}
          </p>

          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Your name</label>
            <input
              style={styles.loginInput}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Alex Morgan"
              autoFocus
            />
          </div>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Email</label>
            <input
              type="email"
              style={styles.loginInput}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Password</label>
            <input
              type="password"
              style={styles.loginInput}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>

          {emailError && <div style={styles.loginError}>{emailError}</div>}

          <div style={styles.signupActions}>
            <button style={styles.perfCancelBtn} onClick={() => setStep('who')}>Back</button>
            <button
              style={{ ...styles.loginSubmit, flex: 1 }}
              onClick={handleIdentityNext}
            >
              Continue
            </button>
          </div>

          <p style={styles.signupFinePrint}>
            By continuing, you agree this is a demo build. No data leaves your device.
          </p>
        </div>
      </div>
    );
  }

  // ===== STEP: SPORT =====
  // ===== STEP: ROLE (staff only) =====
  if (step === 'role') {
    const roleInfo = staffRoles.find(r => r.k === staffRole);
    return (
      <div style={styles.loginFrame}>
        <div style={styles.loginInner}>
          <div style={styles.signupStep}>Step 3 of 4</div>
          <h1 style={styles.signupTitle}>What's your role?</h1>
          <p style={styles.signupIntro}>
            This sets up sensible default permissions for the athletes you work with.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {staffRoles.map(r => (
              <button
                key={r.k}
                onClick={() => setStaffRole(r.k)}
                style={{
                  ...styles.signupSportBtn,
                  ...(staffRole === r.k ? styles.signupSportBtnActive : {})
                }}
              >
                <span style={styles.signupSportIcon}>◆</span>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={styles.signupSportLabel}>{r.l}</div>
                  <div style={styles.signupSportDesc}>{r.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {staffRole && (
            <div style={styles.loginField}>
              <label style={styles.loginLabel}>Title (optional)</label>
              <input
                style={styles.loginInput}
                value={staffTitle}
                onChange={e => setStaffTitle(e.target.value)}
                placeholder={roleInfo?.titlePlaceholder || ''}
              />
            </div>
          )}

          <div style={styles.signupActions}>
            <button style={styles.perfCancelBtn} onClick={() => setStep('identity')}>Back</button>
            <button
              style={{ ...styles.loginSubmit, flex: 1, opacity: staffRole ? 1 : 0.4 }}
              disabled={!staffRole}
              onClick={() => setStep('welcome')}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'sport') {
    return (
      <div style={styles.loginFrame}>
        <div style={styles.loginInner}>
          <div style={styles.signupStep}>Step 3 of 4</div>
          <h1 style={styles.signupTitle}>What do you train for?</h1>
          <p style={styles.signupIntro}>
            We'll set up sensible defaults based on your sport. You can always change this later.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sports.map(s => (
              <button
                key={s.k}
                onClick={() => setSport(s.k)}
                style={{
                  ...styles.signupSportBtn,
                  ...(sport === s.k ? styles.signupSportBtnActive : {})
                }}
              >
                <span style={styles.signupSportIcon}>{s.icon}</span>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={styles.signupSportLabel}>{s.l}</div>
                  <div style={styles.signupSportDesc}>{s.desc}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={styles.signupActions}>
            <button style={styles.perfCancelBtn} onClick={() => setStep('identity')}>Back</button>
            <button
              style={{ ...styles.loginSubmit, flex: 1, opacity: sport ? 1 : 0.4 }}
              disabled={!sport}
              onClick={() => setStep('welcome')}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== STEP: WELCOME =====
  if (step === 'welcome') {
    const sportInfo = sports.find(s => s.k === sport);
    const roleInfo = staffRoles.find(r => r.k === staffRole);
    const isStaff = accountType === 'staff';

    return (
      <div style={styles.loginFrame}>
        <div style={styles.loginInner}>
          <div style={styles.signupStep}>Step 4 of 4</div>
          <h1 style={styles.signupTitle}>You're all set, {name.split(' ')[0]}</h1>

          <div style={styles.signupSummaryCard}>
            <div style={styles.signupSummaryRow}>
              <span style={styles.signupSummaryLabel}>Account</span>
              <span style={styles.signupSummaryValue}>{email}</span>
            </div>
            <div style={styles.signupSummaryRow}>
              <span style={styles.signupSummaryLabel}>{isStaff ? 'Role' : 'Training focus'}</span>
              <span style={styles.signupSummaryValue}>
                {isStaff ? (staffTitle.trim() || roleInfo?.l) : sportInfo?.l}
              </span>
            </div>
            <div style={styles.signupSummaryRow}>
              <span style={styles.signupSummaryLabel}>Affiliation</span>
              <span style={styles.signupSummaryValue}>
                {isStaff ? 'Independent practitioner' : 'Independent athlete'}
              </span>
            </div>
          </div>

          <div style={styles.signupNextCard}>
            <div style={styles.signupNextLabel}>What's next</div>
            <ul style={styles.signupNextList}>
              {isStaff ? (
                <>
                  <li>Invite athletes to give you access to their training data</li>
                  <li>Build your caseload across clubs, teams, or private clients</li>
                  <li>Add notes, log injuries, track tests — depending on your role</li>
                </>
              ) : (
                <>
                  <li>Log your first workout and rate it</li>
                  <li>Complete a quick wellness check-in</li>
                  <li>Invite a clinician, coach, or anyone helping you train</li>
                </>
              )}
            </ul>
            <p style={styles.signupNextNote}>
              {isStaff
                ? 'Athletes control their own data — they choose what to share with you.'
                : "You're in full control. You decide who sees what, and you can revoke access any time."}
            </p>
          </div>

          {submitError && <div style={styles.loginError}>{submitError}</div>}

          <div style={styles.signupActions}>
            <button
              style={styles.perfCancelBtn}
              onClick={() => setStep(isStaff ? 'role' : 'sport')}
              disabled={busy}
            >
              Back
            </button>
            <button
              style={{ ...styles.loginSubmit, flex: 1, opacity: busy ? 0.6 : 1 }}
              onClick={handleFinish}
              disabled={busy}
            >
              {busy ? 'Creating account…' : (isStaff ? 'Open caseload' : 'Start training')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}


function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showSignup, setShowSignup] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setError(null);
    if (!email) { setError('Enter your email.'); return; }
    if (!password) { setError('Enter your password.'); return; }
    setBusy(true);
    const { error: authError } = await signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) {
      setError(
        /invalid login credentials/i.test(authError.message)
          ? 'That email or password is incorrect.'
          : authError.message
      );
      return;
    }
    // Success: the App-level auth listener picks up the session and routes in.
  };

  if (showSignup) {
    return (
      <SignupFlow
        onComplete={() => setShowSignup(false)}
        onCancel={() => setShowSignup(false)}
      />
    );
  }

  return (
    <div style={styles.loginFrame}>
      <div style={styles.loginInner}>
        <div style={styles.loginMark}>◐</div>
        <div style={styles.loginBrand}>tempo</div>
        <div style={styles.loginTagline}>Sign in</div>

        <form onSubmit={handleSubmit} style={styles.loginForm}>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Email</label>
            <input
              type="email"
              autoComplete="username"
              style={styles.loginInput}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div style={styles.loginField}>
            <label style={styles.loginLabel}>Password</label>
            <input
              type="password"
              autoComplete="current-password"
              style={styles.loginInput}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <div style={styles.loginError}>{error}</div>}

          <button type="submit" style={{ ...styles.loginSubmit, opacity: busy ? 0.6 : 1 }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div style={styles.loginLinks}>
            <a style={styles.loginLink} onClick={() => setShowSignup(true)}>Don't have an account? Create one</a>
          </div>
        </form>

        <div style={styles.loginDivider}>
          <span style={styles.loginDividerText}>OR</span>
        </div>

        <button
          style={styles.loginSignupBtn}
          onClick={() => setShowSignup(true)}
        >
          Create an account
        </button>

        <div style={styles.loginFoot}>
          Pilot build
        </div>
      </div>
    </div>
  );
}

// ============================================================
// IdentitySwitcher — pick which user to be (demo / role switching)
// ============================================================
function IdentitySwitcher({ currentUserId, onPick, onClose, asLoginPicker }) {
  const [users, setUsers] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [links, setLinks] = useState([]);

  useEffect(() => {
    const seed = getSeedData();
    setUsers(seed.teamUsers || []);
    setAthletes(seed.teamAthletes || []);
    setLinks(seed.teamAthleteLinks || []);
  }, []);

  const linksFor = (userId) => links.filter(l => l.userId === userId && l.status === 'active');

  const staffUsers = users.filter(u => u.isStaff);
  const athleteUsers = users.filter(u => !u.isStaff);

  // Pretty role name
  const roleName = (r) => ({
    head_coach: 'Head Coach',
    sc_coach: 'S&C Coach',
    physio: 'Physio',
    consultant: 'Consultant',
    club_admin: 'Club Admin',
    athlete: 'Athlete'
  }[r] || r);

  return (
    <div
      style={asLoginPicker ? styles.loginFrame : styles.modalBackdrop}
      onClick={asLoginPicker ? undefined : onClose}
    >
      <div
        style={asLoginPicker ? styles.identityPickerFrame : styles.modalCard}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.modalHead}>
          <div>
            <div style={styles.modalKicker}>{asLoginPicker ? 'Demo mode' : 'Switch identity'}</div>
            <div style={styles.modalTitle}>Sign in as</div>
          </div>
          {!asLoginPicker && (
            <button style={styles.modalClose} onClick={onClose}><X size={18} /></button>
          )}
        </div>

        <p style={styles.modalIntro}>
          Each user sees a different view of the same data, based on their role and what they're linked to.
        </p>

        <div style={styles.modalKicker2}>Staff</div>
        {staffUsers.map(u => {
          const userLinks = linksFor(u.id);
          const linkCount = userLinks.length;
          const active = currentUserId === u.id;
          return (
            <button
              key={u.id}
              style={{ ...styles.identityPick, ...(active ? styles.identityPickActive : {}) }}
              onClick={() => onPick(u)}
            >
              <div style={{ ...styles.identityAvatar, background: active ? '#c8b894' : '#efeadd' }}>
                {u.avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.identityName}>
                  {u.name}
                  {u.athleteId && (
                    <span style={styles.dualIdentityChip}>+ athlete</span>
                  )}
                </div>
                <div style={styles.identityMeta}>
                  {u.title} · {roleName(u.role)}
                </div>
                <div style={styles.identityScope}>
                  Linked to {linkCount} {linkCount === 1 ? 'athlete' : 'athletes'}
                </div>
              </div>
            </button>
          );
        })}

        <div style={styles.modalKicker2}>Athletes</div>
        {athleteUsers.map(u => {
          const athlete = athletes.find(a => a.id === u.athleteId);
          const active = currentUserId === u.id;
          return (
            <button
              key={u.id}
              style={{ ...styles.identityPick, ...(active ? styles.identityPickActive : {}) }}
              onClick={() => onPick(u)}
            >
              <div style={{ ...styles.identityAvatar, background: active ? '#c8b894' : '#efeadd' }}>
                {u.avatar}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.identityName}>
                  {u.name}
                  {u.independent && (
                    <span style={styles.dualIdentityChip}>independent</span>
                  )}
                </div>
                <div style={styles.identityMeta}>
                  {athlete?.position} · {u.independent ? 'No club affiliation' : 'Personal account'}
                </div>
                <div style={styles.identityScope}>
                  {u.independent
                    ? 'Sees only their own data · invites support staff individually'
                    : 'Sees only their own data'}
                </div>
              </div>
            </button>
          );
        })}

        {asLoginPicker && (
          <button
            style={{ ...styles.perfCancelBtn, marginTop: 16 }}
            onClick={onClose}
          >
            ← Back to sign in
          </button>
        )}
      </div>
    </div>
  );
}

// Old AthleteSwitcher kept as a thin alias for any leftover references
function AthleteSwitcher(props) {
  return null;
}

// ============================================================
// Styles — editorial, off-white paper, ink black, single accent
// ============================================================
const globalCSS = `
  * { box-sizing: border-box; }
  body, html { margin: 0; padding: 0; }
  input[type="range"] { -webkit-appearance: none; appearance: none; }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 20px; height: 20px; border-radius: 50%;
    background: #1a1a1a; cursor: pointer; border: 3px solid #f5f1e8;
    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
  }
  input[type="range"]::-moz-range-thumb {
    width: 20px; height: 20px; border-radius: 50%;
    background: #1a1a1a; cursor: pointer; border: 3px solid #f5f1e8;
  }
  button { font-family: inherit; }
  button:active { transform: scale(0.99); }
  /* Hide scrollbar on horizontally-scrolling tab bars */
  .tempo-scroll-x::-webkit-scrollbar { display: none; }
  .tempo-scroll-x { -ms-overflow-style: none; scrollbar-width: none; }
  @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes sheetin { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
`;

const styles = {
  root: {
    minHeight: '100vh',
    background: '#f0ebe0',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    color: '#1a1a1a',
    fontFeatureSettings: '"ss01", "cv11"',
    padding: 20
  },

  // ===== LOGIN SCREEN =====
  loginFrame: {
    maxWidth: 420,
    margin: '0 auto',
    background: '#f5f1e8',
    minHeight: '90vh',
    borderRadius: 28,
    padding: '48px 32px 40px',
    boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 12px 40px -12px rgba(0,0,0,0.18)',
    border: '1px solid #e8e4dc',
    animation: 'fadein 0.4s ease'
  },
  loginInner: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  loginMark: {
    fontSize: 44, color: '#1a1a1a', lineHeight: 1, marginBottom: 8
  },
  loginBrand: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em',
    color: '#1a1a1a', marginBottom: 6
  },
  loginTagline: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 15, fontStyle: 'italic', color: '#5a564d',
    letterSpacing: '-0.01em', marginBottom: 32
  },
  loginForm: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 16
  },
  loginField: {
    display: 'flex', flexDirection: 'column', gap: 6
  },
  loginLabel: {
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600
  },
  loginInput: {
    width: '100%', padding: '12px 14px',
    background: '#fdfbf5', border: '1px solid #e0d9c8',
    borderRadius: 8, fontSize: 14, color: '#1a1a1a',
    fontFamily: 'inherit', boxSizing: 'border-box'
  },
  loginSubmit: {
    width: '100%', padding: '14px',
    background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 100,
    fontSize: 14, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', cursor: 'pointer',
    fontFamily: 'inherit', marginTop: 6
  },
  loginError: {
    background: '#fdf5f0', border: '1px solid #f0cbb8',
    borderLeft: '3px solid #c8472b',
    borderRadius: 8, padding: '10px 14px',
    fontSize: 12, color: '#9c3a23'
  },
  loginLinks: {
    display: 'flex', justifyContent: 'center', gap: 8,
    marginTop: 4
  },
  loginLink: {
    color: '#5a564d', fontSize: 12,
    textDecoration: 'underline', cursor: 'pointer',
    letterSpacing: '0.02em'
  },
  loginLinkDivider: {
    color: '#c8b894', fontSize: 12
  },
  loginDivider: {
    width: '100%', position: 'relative',
    margin: '28px 0', textAlign: 'center'
  },
  loginDividerText: {
    background: '#f5f1e8',
    padding: '0 12px',
    fontSize: 10, letterSpacing: '0.16em',
    color: '#8a8275', fontWeight: 600,
    position: 'relative', zIndex: 1
  },
  loginDemoBtn: {
    width: '100%', padding: '12px',
    background: 'transparent', color: '#5a564d',
    border: '1px solid #c8b894', borderRadius: 100,
    fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', cursor: 'pointer',
    fontFamily: 'inherit'
  },
  loginSignupBtn: {
    width: '100%', padding: '14px',
    background: '#fdfbf5', color: '#1a1a1a',
    border: '1px solid #1a1a1a', borderRadius: 100,
    fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit',
    marginBottom: 10
  },
  loginFoot: {
    marginTop: 32, fontSize: 11,
    color: '#8a8275', letterSpacing: '0.1em',
    textTransform: 'uppercase'
  },

  // ===== SIGNUP =====
  signupStep: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#c8472b', fontWeight: 600, marginBottom: 12
  },
  signupTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 28, fontWeight: 400, color: '#1a1a1a',
    letterSpacing: '-0.02em', lineHeight: 1.15,
    margin: '0 0 12px 0'
  },
  signupIntro: {
    fontSize: 14, color: '#5a564d', lineHeight: 1.5,
    margin: '0 0 24px 0'
  },
  signupActions: {
    display: 'flex', gap: 10, marginTop: 24
  },
  signupFinePrint: {
    fontSize: 11, color: '#8a8275',
    marginTop: 18, lineHeight: 1.5, fontStyle: 'italic',
    textAlign: 'center'
  },
  signupSportBtn: {
    display: 'flex', alignItems: 'center', gap: 14,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '14px 16px',
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.15s ease', width: '100%'
  },
  signupSportBtnActive: {
    borderColor: '#1a1a1a',
    background: '#fdfbf5',
    boxShadow: '0 0 0 1px #1a1a1a'
  },
  signupSportIcon: {
    width: 36, height: 36, borderRadius: '50%',
    background: '#efeadd', color: '#1a1a1a',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 18, flexShrink: 0
  },
  signupSportLabel: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  signupSportDesc: {
    fontSize: 11, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em'
  },
  signupSummaryCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '14px 16px',
    margin: '8px 0 14px 0'
  },
  signupSummaryRow: {
    display: 'flex', justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #efeadd'
  },
  signupSummaryLabel: {
    fontSize: 11, color: '#8a8275', letterSpacing: '0.04em'
  },
  signupSummaryValue: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500,
    textAlign: 'right', minWidth: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    marginLeft: 12
  },
  signupNextCard: {
    background: '#f5f1e8', borderRadius: 12,
    padding: '14px 16px',
    margin: '8px 0 14px 0'
  },
  signupNextLabel: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600, marginBottom: 8
  },
  signupNextList: {
    margin: 0, padding: '0 0 0 18px',
    fontSize: 13, color: '#1a1a1a', lineHeight: 1.7
  },
  signupNextNote: {
    fontSize: 12, color: '#5a564d',
    margin: '12px 0 0 0',
    fontStyle: 'italic', lineHeight: 1.5
  },

  // ===== First-run athlete welcome =====
  firstRunCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 14, padding: '18px',
    marginBottom: 20,
    display: 'flex', flexDirection: 'column', gap: 12
  },
  firstRunHead: {
    display: 'flex', alignItems: 'center', gap: 12,
    paddingBottom: 12,
    borderBottom: '1px solid #efeadd'
  },
  firstRunIcon: {
    width: 42, height: 42, borderRadius: '50%',
    background: '#1a1a1a', color: '#f5f1e8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, flexShrink: 0
  },
  firstRunTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', lineHeight: 1.2
  },
  firstRunSubtitle: {
    fontSize: 11, color: '#8a8275', marginTop: 3,
    letterSpacing: '0.02em'
  },
  firstRunStep: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    paddingTop: 4
  },
  firstRunStepNum: {
    width: 24, height: 24, borderRadius: '50%',
    background: '#efeadd', color: '#5a564d',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 600,
    flexShrink: 0
  },
  firstRunStepTitle: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500
  },
  firstRunStepDesc: {
    fontSize: 11, color: '#8a8275', marginTop: 3,
    lineHeight: 1.5
  },
  firstRunNote: {
    margin: '8px 0 0 0',
    padding: '10px 12px',
    background: '#f5f1e8', borderRadius: 8,
    fontSize: 11, color: '#5a564d',
    fontStyle: 'italic', lineHeight: 1.5
  },

  // ===== IDENTITY PICKER =====
  identityPickerFrame: {
    width: '100%', maxWidth: 420, margin: '0 auto',
    padding: '24px',
    background: '#f5f1e8',
    minHeight: '90vh',
    borderRadius: 28,
    border: '1px solid #e8e4dc',
    boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 12px 40px -12px rgba(0,0,0,0.18)'
  },
  identityPick: {
    display: 'flex', alignItems: 'center', gap: 12,
    width: '100%', padding: '12px 14px',
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, marginBottom: 8,
    cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'left',
    transition: 'border-color 0.15s ease'
  },
  identityPickActive: {
    borderColor: '#1a1a1a', background: '#fdfbf5'
  },
  identityAvatar: {
    width: 40, height: 40, borderRadius: '50%',
    background: '#efeadd', color: '#5a564d',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, letterSpacing: '0.02em',
    flexShrink: 0, transition: 'background 0.15s ease'
  },
  identityName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', lineHeight: 1.35
  },
  dualIdentityChip: {
    marginLeft: 8,
    fontSize: 9, padding: '2px 8px', borderRadius: 100,
    background: '#fdf5e9', color: '#a37b1a',
    letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600,
    border: '1px solid #efd9a8',
    verticalAlign: 'middle',
    fontFamily: 'Inter, system-ui, sans-serif',
    whiteSpace: 'nowrap',
    display: 'inline-block'
  },
  identityMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em'
  },
  identityScope: {
    fontSize: 10, color: '#5a564d', marginTop: 3,
    letterSpacing: '0.02em', fontStyle: 'italic'
  },

  // ===== USER BADGE (header) =====
  userBadgeWrap: {
    position: 'relative',
    zIndex: 80
  },
  userBadge: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 100, padding: '6px 14px 6px 6px',
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0
  },
  userBadgeAvatar: {
    width: 30, height: 30, borderRadius: '50%',
    background: '#1a1a1a', color: '#f5f1e8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 12, fontWeight: 500, letterSpacing: '0.02em',
    flexShrink: 0
  },
  userBadgeNameCol: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'flex-start', minWidth: 0
  },
  userBadgeName: {
    fontSize: 13, fontWeight: 500, color: '#1a1a1a',
    lineHeight: 1.1
  },
  userBadgeRole: {
    fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, marginTop: 2
  },

  // ===== User sheet (modal opened from the badge) =====
  userSheetBackdrop: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(20, 18, 14, 0.4)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    padding: 16,
    animation: 'fadein 0.18s ease'
  },
  userSheet: {
    width: '100%', maxWidth: 420,
    background: '#fdfbf5',
    borderRadius: 20,
    boxShadow: '0 -8px 40px -8px rgba(0,0,0,0.32), 0 -2px 8px -2px rgba(0,0,0,0.14)',
    border: '1px solid #e8e4dc',
    padding: '14px 0 8px',
    animation: 'sheetin 0.25s cubic-bezier(.22,.91,.34,1)'
  },
  userSheetGrip: {
    width: 36, height: 4,
    background: '#c8b894',
    borderRadius: 100,
    margin: '0 auto 14px'
  },
  userSheetHead: {
    display: 'flex', alignItems: 'flex-start', gap: 14,
    padding: '4px 20px 16px',
    borderBottom: '1px solid #efeadd'
  },
  userSheetAvatar: {
    width: 48, height: 48, borderRadius: '50%',
    background: '#1a1a1a', color: '#f5f1e8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 500,
    flexShrink: 0
  },
  userSheetName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', lineHeight: 1.2
  },
  userSheetEmail: {
    fontSize: 12, color: '#8a8275', marginTop: 3,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  },
  userSheetRole: {
    fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600, marginTop: 6
  },
  userSheetClose: {
    background: 'transparent', border: 'none',
    color: '#8a8275', cursor: 'pointer',
    padding: 4, flexShrink: 0
  },
  userSheetItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', padding: '18px 20px',
    background: 'transparent', border: 'none',
    fontSize: 15, color: '#1a1a1a', textAlign: 'left',
    cursor: 'pointer', fontFamily: 'inherit'
  },
  userSheetItemArrow: {
    color: '#8a8275', fontSize: 16
  },

  // ===== Privacy & access =====
  privacySection: {
    marginBottom: 24
  },
  privacySectionLabel: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600, marginBottom: 12
  },
  privacyLinkCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 14, padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 12
  },
  privacyLinkHead: {
    display: 'flex', alignItems: 'flex-start', gap: 12
  },
  privacyLinkAvatar: {
    width: 36, height: 36, borderRadius: '50%',
    background: '#1a1a1a', color: '#f5f1e8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 13, fontWeight: 500,
    flexShrink: 0
  },
  privacyLinkName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', lineHeight: 1.2
  },
  privacyLinkRole: {
    fontSize: 11, color: '#5a564d', marginTop: 3,
    letterSpacing: '0.02em'
  },
  privacyLinkMeta: {
    fontSize: 10, color: '#8a8275', marginTop: 4,
    letterSpacing: '0.02em', fontStyle: 'italic'
  },
  privacyPermBar: {
    display: 'flex', gap: 4, flexWrap: 'wrap'
  },
  privacyPermChip: {
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 100, padding: '3px 10px',
    fontSize: 10, color: '#5a564d',
    letterSpacing: '0.02em', fontWeight: 500
  },
  privacyRevokeBtn: {
    background: 'transparent', color: '#9c3a23',
    border: '1px solid #f0cbb8', borderRadius: 8,
    padding: '8px 14px', fontSize: 12, fontWeight: 600,
    letterSpacing: '0.04em', cursor: 'pointer',
    fontFamily: 'inherit', width: '100%'
  },
  privacyAuditRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px',
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10
  },
  privacyAuditAvatar: {
    width: 28, height: 28, borderRadius: '50%',
    background: '#efeadd', color: '#5a564d',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 11, fontWeight: 500,
    flexShrink: 0
  },
  privacyAuditAction: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500
  },
  privacyAuditMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em'
  },

  // ===== Team access screen =====
  teamAccessIntro: {
    marginBottom: 14
  },
  teamAccessActionBar: {
    marginBottom: 18
  },
  teamAccessUserCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 14, padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 12
  },
  teamAccessUserHead: {
    display: 'flex', alignItems: 'flex-start', gap: 12
  },
  teamAccessPendingBadge: {
    background: '#fdf5e9', color: '#a37b1a',
    fontSize: 9, padding: '3px 9px', borderRadius: 100,
    letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
    border: '1px solid #efd9a8', flexShrink: 0
  },
  teamAccessAthleteList: {
    background: '#f5f1e8', borderRadius: 8, padding: '10px 12px'
  },
  teamAccessAthleteListLabel: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600, marginBottom: 8
  },
  teamAccessAthleteChips: {
    display: 'flex', gap: 4, flexWrap: 'wrap'
  },
  teamAccessAthleteChip: {
    background: '#fdfbf5', border: '1px solid #e0d9c8',
    borderRadius: 100, padding: '3px 10px',
    fontSize: 11, color: '#1a1a1a',
    letterSpacing: '0.02em'
  },

  // ===== Invite flow =====
  inviteSegment: {
    display: 'flex', gap: 4,
    background: '#efeadd', borderRadius: 100, padding: 4,
    marginBottom: 16
  },
  inviteSegmentBtn: {
    flex: 1, background: 'transparent', border: 'none',
    padding: '9px 16px', borderRadius: 100,
    fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
    color: '#5a564d', cursor: 'pointer', fontFamily: 'inherit'
  },
  inviteSegmentBtnActive: {
    background: '#1a1a1a', color: '#f5f1e8'
  },
  inviteActions: {
    display: 'flex', gap: 10, marginTop: 20
  },
  inviteAthleteRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '12px 14px',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    width: '100%'
  },
  inviteAthleteRowActive: {
    background: '#fdfbf5', borderColor: '#1a1a1a'
  },
  inviteCheckbox: {
    width: 22, height: 22, borderRadius: 6,
    border: '1.5px solid #c8b894', background: 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, color: '#f5f1e8', flexShrink: 0
  },
  inviteCheckboxActive: {
    background: '#1a1a1a', borderColor: '#1a1a1a'
  },
  inviteBulkBtn: {
    background: 'transparent', color: '#5a564d',
    border: '1px solid #c8b894', borderRadius: 100,
    padding: '7px 14px', fontSize: 11, fontWeight: 600,
    letterSpacing: '0.06em', textTransform: 'uppercase',
    cursor: 'pointer', fontFamily: 'inherit',
    marginBottom: 12
  },
  invitePermRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '12px 14px',
    cursor: 'pointer', fontFamily: 'inherit'
  },
  invitePermRowActive: {
    borderColor: '#1a1a1a'
  },
  invitePermSensitive: {
    marginLeft: 8,
    fontSize: 9, padding: '2px 8px', borderRadius: 100,
    background: '#fdf5f0', color: '#9c3a23',
    letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600,
    border: '1px solid #f0cbb8'
  },
  invitePermToggle: {
    display: 'inline-block',
    width: 42, height: 24, borderRadius: 100,
    border: 'none', cursor: 'pointer', position: 'relative',
    padding: 0, transition: 'background 0.2s ease',
    flexShrink: 0,
    verticalAlign: 'middle'
  },
  invitePermToggleKnob: {
    position: 'absolute', top: 2, left: 0,
    width: 20, height: 20, borderRadius: '50%',
    background: '#fdfbf5',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s ease'
  },
  inviteReviewCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '12px 14px',
    marginBottom: 10
  },

  // ===== Bulk testing session =====
  // ===== Note composer (practitioner side) =====
  noteComposerOpenBtn: {
    width: '100%',
    background: 'transparent', color: '#1a1a1a',
    border: '1px dashed #c8b894', borderRadius: 12,
    padding: '14px 16px',
    fontSize: 13, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
    marginBottom: 14
  },
  noteComposerCard: {
    background: '#fdfbf5', border: '1px solid #c8b894',
    borderRadius: 14, padding: '16px 18px',
    marginBottom: 14
  },
  noteComposerHead: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12
  },
  noteComposerTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  noteComposerTextarea: {
    width: '100%',
    padding: '12px 14px',
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 10,
    fontSize: 13, color: '#1a1a1a',
    fontFamily: 'inherit', lineHeight: 1.5,
    resize: 'vertical', boxSizing: 'border-box',
    marginBottom: 14
  },
  noteComposerLabel: {
    fontSize: 10, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: '#8a8275', fontWeight: 600,
    marginBottom: 8
  },
  noteComposerVisRow: {
    display: 'flex', gap: 6, flexWrap: 'wrap',
    marginBottom: 8
  },
  noteComposerVisBtn: {
    flex: 1, minWidth: 80,
    background: '#fdfbf5', color: '#5a564d',
    border: '1px solid #e0d9c8', borderRadius: 100,
    padding: '8px 12px', fontSize: 11, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit'
  },
  noteComposerVisBtnActive: {
    background: '#1a1a1a', color: '#f5f1e8',
    borderColor: '#1a1a1a', fontWeight: 600
  },
  noteComposerVisHint: {
    fontSize: 11, color: '#5a564d',
    fontStyle: 'italic', lineHeight: 1.5,
    margin: '0 0 14px 0'
  },
  noteComposerActions: {
    display: 'flex', gap: 8
  },

  // ===== Athlete Settings =====
  settingsGroupLabel: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em',
    marginBottom: 6, marginTop: 10
  },
  settingsGroupHint: {
    fontSize: 12, color: '#5a564d',
    lineHeight: 1.5, marginBottom: 14
  },
  settingsFreqBtn: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '14px 16px',
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'border-color 0.15s ease'
  },
  settingsFreqBtnActive: {
    borderColor: '#1a1a1a'
  },
  settingsFreqRadio: {
    width: 20, height: 20, borderRadius: '50%',
    border: '2px solid #c8b894',
    background: 'transparent',
    flexShrink: 0, marginTop: 2,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  settingsFreqRadioActive: {
    borderColor: '#1a1a1a'
  },
  settingsFreqRadioDot: {
    width: 10, height: 10, borderRadius: '50%',
    background: '#1a1a1a'
  },
  settingsFreqLabel: {
    fontSize: 14, fontWeight: 600, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  settingsFreqDesc: {
    fontSize: 12, color: '#5a564d',
    lineHeight: 1.5, marginTop: 4
  },
  settingsConsequence: {
    marginTop: 14,
    padding: '12px 14px',
    background: '#fdf5e9', border: '1px solid #efd9a8',
    borderRadius: 10
  },
  settingsConsequenceTitle: {
    fontSize: 11, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#a37b1a', fontWeight: 600,
    marginBottom: 6
  },
  settingsConsequenceBody: {
    fontSize: 12, color: '#5a564d',
    lineHeight: 1.55, margin: 0
  },
  settingsAdvancedToggle: {
    background: 'transparent', color: '#5a564d',
    border: 'none', padding: '18px 0 8px 0',
    fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
    textDecoration: 'underline'
  },
  settingsAdvancedPanel: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '14px 16px 4px',
    marginBottom: 10
  },
  settingsFieldRow: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '10px 0', borderBottom: '1px solid #efeadd'
  },
  settingsFieldLabel: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500
  },
  settingsFieldHint: {
    fontSize: 10, color: '#8a8275', marginTop: 2,
    fontStyle: 'italic'
  },

  // ===== Coordination notes panel (athlete home) =====
  coordNotesPanel: {
    background: '#fdfbf5',
    border: '1px solid #e8e4dc',
    borderRadius: 14,
    padding: '14px 16px 6px',
    marginBottom: 20
  },
  coordNotesHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 12,
    marginBottom: 4,
    borderBottom: '1px solid #efeadd'
  },
  coordNotesLabel: {
    fontSize: 10, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: '#8a8275', fontWeight: 600
  },
  coordNotesCount: {
    fontSize: 11, color: '#5a564d',
    background: '#efeadd', padding: '2px 8px',
    borderRadius: 100, fontWeight: 600
  },
  coordNote: {
    padding: '12px 0',
    borderBottom: '1px solid #efeadd'
  },
  coordNoteHead: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'baseline', marginBottom: 6,
    gap: 8
  },
  coordNoteAuthor: {
    display: 'flex', flexDirection: 'column', minWidth: 0
  },
  coordNoteAuthorName: {
    fontSize: 12, fontWeight: 600, color: '#1a1a1a'
  },
  coordNoteAuthorRole: {
    fontSize: 10, color: '#8a8275', marginTop: 1,
    letterSpacing: '0.02em'
  },
  coordNoteDate: {
    fontSize: 10, color: '#8a8275',
    letterSpacing: '0.04em', textTransform: 'uppercase',
    flexShrink: 0
  },
  coordNoteText: {
    fontSize: 13, color: '#1a1a1a',
    lineHeight: 1.55, margin: '0 0 10px 0'
  },
  coordNoteActions: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 10
  },
  coordNoteAckBtn: {
    background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 100,
    padding: '7px 14px', fontSize: 11, fontWeight: 600,
    letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit'
  },
  coordNoteAcked: {
    fontSize: 11, color: '#3a8a4d', fontWeight: 600,
    fontStyle: 'italic'
  },
  coordNoteArchiveBtn: {
    width: 26, height: 26, borderRadius: '50%',
    background: '#efeadd', color: '#5a564d',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0
  },

  // ===== Roster search field =====
  rosterSearchWrap: {
    position: 'relative',
    marginBottom: 12
  },
  rosterSearchInput: {
    width: '100%',
    padding: '11px 36px 11px 14px',
    background: '#fdfbf5',
    border: '1px solid #e0d9c8',
    borderRadius: 10,
    fontSize: 13,
    color: '#1a1a1a',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none'
  },
  rosterSearchClear: {
    position: 'absolute',
    right: 8, top: '50%', transform: 'translateY(-50%)',
    width: 26, height: 26, borderRadius: '50%',
    background: '#efeadd', color: '#5a564d',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0
  },
  rosterSearchEmpty: {
    padding: '24px 16px',
    background: '#fdfbf5',
    border: '1px dashed #e0d9c8',
    borderRadius: 10,
    fontSize: 13, color: '#5a564d', textAlign: 'center',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
  },
  rosterSearchEmptyBtn: {
    background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 100,
    padding: '8px 16px', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit'
  },

  // ===== Test search field =====
  testSearchWrap: {
    position: 'relative',
    marginBottom: 12
  },
  testSearchInput: {
    width: '100%',
    padding: '11px 36px 11px 14px',
    background: '#fdfbf5',
    border: '1px solid #e0d9c8',
    borderRadius: 10,
    fontSize: 13,
    color: '#1a1a1a',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none'
  },
  testSearchClear: {
    position: 'absolute',
    right: 8, top: '50%', transform: 'translateY(-50%)',
    width: 26, height: 26, borderRadius: '50%',
    background: '#efeadd', color: '#5a564d',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0
  },
  testSearchEmpty: {
    padding: '20px 16px',
    background: '#fdfbf5',
    border: '1px dashed #e0d9c8',
    borderRadius: 10,
    fontSize: 12, color: '#5a564d', textAlign: 'center',
    fontStyle: 'italic'
  },

  // ===== CSV upload =====
  testUploadHeroCard: {
    background: '#1a1a1a', color: '#f5f1e8',
    borderRadius: 14, padding: '18px 18px 16px',
    marginBottom: 12
  },
  testUploadHeroLabel: {
    fontSize: 10, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: '#c8b894', fontWeight: 600,
    marginBottom: 6
  },
  testUploadHeroTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 500, color: '#f5f1e8',
    letterSpacing: '-0.01em', marginBottom: 8
  },
  testUploadHeroBody: {
    fontSize: 12, color: '#c8b894', lineHeight: 1.55,
    margin: '0 0 14px 0'
  },
  testUploadHeroBtn: {
    background: '#f5f1e8', color: '#1a1a1a',
    border: 'none', borderRadius: 100,
    padding: '11px 18px', fontSize: 13, fontWeight: 600,
    letterSpacing: '0.04em', cursor: 'pointer', fontFamily: 'inherit',
    width: '100%'
  },
  uploadFormatCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '14px 16px',
    marginBottom: 12
  },
  uploadFormatHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12, gap: 12, flexWrap: 'wrap'
  },
  uploadFormatTitle: {
    fontSize: 11, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#8a8275', fontWeight: 600,
    marginBottom: 10
  },
  uploadFormatExample: {
    background: '#1a1a1a', color: '#f5f1e8',
    borderRadius: 8, padding: '10px 12px',
    marginBottom: 12,
    overflowX: 'auto',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 11, lineHeight: 1.7
  },
  uploadFormatExampleHeader: {
    color: '#c8b894', whiteSpace: 'nowrap'
  },
  uploadFormatExampleRow: {
    whiteSpace: 'nowrap'
  },
  uploadFormatTips: {
    display: 'flex', flexDirection: 'column', gap: 6
  },
  uploadFormatTip: {
    fontSize: 12, color: '#5a564d', lineHeight: 1.5
  },
  uploadTemplateBtn: {
    background: 'transparent', color: '#1a1a1a',
    border: '1px solid #c8b894', borderRadius: 100,
    padding: '6px 12px', fontSize: 11, fontWeight: 600,
    letterSpacing: '0.04em', cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap'
  },
  uploadFormatBody: {
    display: 'flex', flexDirection: 'column', gap: 6
  },
  uploadFormatRow: {
    display: 'flex', alignItems: 'baseline', gap: 8
  },
  uploadFormatCol: {
    fontSize: 11, color: '#8a8275', minWidth: 90,
    letterSpacing: '0.02em'
  },
  uploadFormatVal: {
    fontSize: 12, color: '#1a1a1a',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    lineHeight: 1.5
  },
  uploadInputCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '14px 16px',
    marginBottom: 12
  },
  uploadInputHead: {
    marginBottom: 10
  },
  uploadInputLabel: {
    fontSize: 10, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: '#8a8275', fontWeight: 600
  },
  uploadInputDivider: {
    fontSize: 11, color: '#8a8275',
    margin: '4px 0 10px 0', fontStyle: 'italic'
  },
  uploadTextarea: {
    width: '100%',
    padding: '10px 12px',
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 8,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12, color: '#1a1a1a',
    boxSizing: 'border-box', marginBottom: 12,
    resize: 'vertical'
  },
  uploadParseBtn: {
    background: 'transparent', color: '#1a1a1a',
    border: '1px solid #1a1a1a', borderRadius: 100,
    padding: '10px 18px', fontSize: 13, fontWeight: 600,
    letterSpacing: '0.04em', cursor: 'pointer', fontFamily: 'inherit',
    width: '100%'
  },
  uploadPreviewCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '14px 16px',
    marginBottom: 12
  },
  uploadPreviewHead: {
    paddingBottom: 12,
    borderBottom: '1px solid #efeadd',
    marginBottom: 12
  },
  uploadPreviewTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 15, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  uploadPreviewMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 3,
    letterSpacing: '0.02em'
  },
  uploadPreviewEmpty: {
    fontSize: 12, color: '#5a564d',
    textAlign: 'center', padding: '12px 0',
    fontStyle: 'italic'
  },
  uploadPreviewList: {
    display: 'flex', flexDirection: 'column', gap: 6,
    maxHeight: 320, overflowY: 'auto'
  },
  testUploadRow: {
    display: 'flex', gap: 12,
    padding: '8px 10px',
    background: '#f5f1e8', borderRadius: 6,
    borderLeft: '3px solid #6e7e5a' // green-ish for valid
  },
  testUploadRowInvalid: {
    borderLeft: '3px solid #b8693d',
    background: '#fdf5e9'
  },
  testUploadRowNum: {
    fontSize: 10, color: '#8a8275',
    letterSpacing: '0.04em', textTransform: 'uppercase',
    fontWeight: 600, flexShrink: 0,
    width: 50
  },
  testUploadRowOk: {
    flex: 1, minWidth: 0
  },
  testUploadRowName: {
    fontSize: 12, color: '#1a1a1a', fontWeight: 500,
    lineHeight: 1.4
  },
  testUploadRowVal: {
    fontSize: 11, color: '#5a564d', marginTop: 2,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace'
  },
  testUploadRowErr: {
    flex: 1, minWidth: 0
  },
  testUploadErrText: {
    fontSize: 11, color: '#b8693d', lineHeight: 1.5
  },

  bulkTestHint: {
    fontSize: 11, color: '#8a8275', fontStyle: 'italic',
    lineHeight: 1.5, marginTop: 10, padding: '8px 10px',
    background: '#f5f1e8', borderRadius: 6
  },
  bulkTestRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '12px 14px'
  },
  bulkTestAvatar: {
    width: 32, height: 32, borderRadius: '50%',
    background: '#efeadd', color: '#5a564d',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 12, fontWeight: 500, flexShrink: 0
  },
  bulkTestNameCol: {
    flex: 1, minWidth: 0
  },
  bulkTestName: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500
  },
  bulkTestMeta: {
    fontSize: 10, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em'
  },
  bulkTestInputCol: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'flex-end', gap: 2,
    flexShrink: 0
  },
  bulkTestInput: {
    width: 80, padding: '8px 10px',
    background: '#fdfbf5', border: '1px solid #c8b894',
    borderRadius: 6,
    fontSize: 14, color: '#1a1a1a', textAlign: 'right',
    fontFamily: 'inherit', boxSizing: 'border-box'
  },
  bulkTestInputSmall: {
    width: 56, padding: '8px 8px',
    background: '#fdfbf5', border: '1px solid #c8b894',
    borderRadius: 6,
    fontSize: 14, color: '#1a1a1a', textAlign: 'right',
    fontFamily: 'inherit', boxSizing: 'border-box'
  },
  bulkTestBilateralRow: {
    display: 'flex', gap: 4
  },
  bulkTestUnit: {
    fontSize: 9, color: '#8a8275',
    letterSpacing: '0.06em', textTransform: 'uppercase'
  },

  // ===== Contacts view =====
  contactsSearchBar: {
    position: 'relative',
    marginBottom: 12
  },
  contactsSearchInput: {
    width: '100%', padding: '12px 36px 12px 14px',
    background: '#fdfbf5', border: '1px solid #e0d9c8',
    borderRadius: 100, fontSize: 14, color: '#1a1a1a',
    fontFamily: 'inherit', boxSizing: 'border-box'
  },
  contactsSearchClear: {
    position: 'absolute', right: 10, top: '50%',
    transform: 'translateY(-50%)',
    background: '#efeadd', border: 'none',
    width: 22, height: 22, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#5a564d', cursor: 'pointer'
  },
  contactsHint: {
    fontSize: 11, color: '#8a8275', fontStyle: 'italic',
    marginBottom: 12, padding: '0 4px', lineHeight: 1.4
  },
  contactCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, overflow: 'hidden'
  },
  contactCardHead: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px',
    background: 'transparent', border: 'none',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
  },
  contactCardAvatar: {
    width: 36, height: 36, borderRadius: '50%',
    background: '#efeadd', color: '#5a564d',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 13, fontWeight: 500, flexShrink: 0
  },
  contactCardName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  contactCardMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em'
  },
  contactCardBody: {
    padding: '0 14px 14px',
    borderTop: '1px solid #efeadd',
    display: 'flex', flexDirection: 'column', gap: 12
  },
  contactSection: {
    paddingTop: 12
  },
  contactSectionLabel: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600, marginBottom: 6
  },
  contactSectionMedical: {
    background: '#fdf5f0', border: '1px solid #f0cbb8',
    borderRadius: 8, padding: '10px 12px', marginTop: 12
  },
  contactSectionLabelMedical: {
    fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: '#9c3a23', fontWeight: 600, marginBottom: 6
  },
  contactRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '8px 0',
    color: '#1a1a1a', textDecoration: 'none',
    borderBottom: '1px solid rgba(232,228,220,0.6)'
  },
  contactRowLabel: {
    fontSize: 11, color: '#8a8275', letterSpacing: '0.04em',
    flexShrink: 0
  },
  contactRowValue: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500,
    textAlign: 'right', minWidth: 0,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    marginLeft: 12
  },
  contactNotShared: {
    padding: '14px 0', fontSize: 12, color: '#8a8275',
    fontStyle: 'italic', textAlign: 'center'
  },
  contactNote: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '10px 12px',
    background: '#f5f1e8', borderRadius: 8,
    fontSize: 12, color: '#5a564d', lineHeight: 1.5,
    fontStyle: 'italic'
  },
  contactNoteIcon: {
    fontSize: 14, color: '#c8b894', flexShrink: 0, lineHeight: 1
  },
  contactProfileBtn: {
    background: 'transparent', color: '#1a1a1a',
    border: '1px solid #c8b894', borderRadius: 100,
    padding: '8px 14px', fontSize: 11, fontWeight: 600,
    letterSpacing: '0.06em', textTransform: 'uppercase',
    cursor: 'pointer', fontFamily: 'inherit',
    width: '100%', marginTop: 4
  },
  contactsFooter: {
    fontSize: 11, color: '#8a8275', fontStyle: 'italic',
    textAlign: 'center', marginTop: 18, letterSpacing: '0.02em'
  },
  contactsSectionWrap: {
    marginBottom: 18
  },
  contactsSectionHead: {
    width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'transparent', border: 'none',
    padding: '10px 4px',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    borderBottom: '1px solid #e0d9c8'
  },
  contactsSectionLabel: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  contactsSectionMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em'
  },
  contactSectionLabelInner: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600, marginBottom: 6
  },

  // ===== Contact sharing panel (athlete-side) =====
  contactShareCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 14, padding: '14px 16px'
  },
  contactShareIntro: {
    fontSize: 11, color: '#8a8275', lineHeight: 1.4,
    margin: '0 0 12px 0', fontStyle: 'italic'
  },
  contactShareRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 0',
    borderTop: '1px solid #efeadd'
  },
  contactShareRowLabel: {
    fontSize: 12, color: '#1a1a1a', fontWeight: 500,
    display: 'flex', alignItems: 'center', gap: 8,
    flexWrap: 'wrap'
  },
  contactShareValue: {
    background: 'transparent', border: 'none',
    padding: '4px 0', marginTop: 2,
    fontSize: 13, color: '#5a564d',
    cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'left'
  },
  contactShareSub: {
    fontSize: 11, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em'
  },
  contactShareTag: {
    fontSize: 9, padding: '2px 6px', borderRadius: 100,
    background: '#fdf5f0', color: '#9c3a23',
    letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600,
    border: '1px solid #f0cbb8'
  },

  // ===== Staff identity card on Privacy & sharing =====
  staffIdentityCard: {
    display: 'flex', alignItems: 'center', gap: 14,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 14, padding: '14px 16px',
    marginBottom: 18
  },

  // ===== INTRO SCREEN =====
  introFrame: {
    maxWidth: 480,
    margin: '0 auto',
    background: '#f5f1e8',
    minHeight: '100vh',
    padding: '40px 24px 40px',
    animation: 'fadein 0.4s ease'
  },
  introInner: {
    textAlign: 'left',
    width: '100%'
  },
  introBrandRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 36
  },
  introMark: {
    fontSize: 28,
    color: '#1a1a1a',
    lineHeight: 1
  },
  introBrand: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 22,
    fontWeight: 500,
    letterSpacing: '-0.02em',
    color: '#1a1a1a'
  },
  introHeadline: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 30,
    fontWeight: 400,
    color: '#1a1a1a',
    letterSpacing: '-0.025em',
    lineHeight: 1.2,
    margin: '0 0 16px 0'
  },
  introSubhead: {
    fontSize: 15,
    lineHeight: 1.55,
    color: '#5a564d',
    margin: '0 0 28px 0'
  },
  introWhoCard: {
    background: '#fdfbf5',
    border: '1px solid #e8e4dc',
    borderRadius: 14,
    padding: '16px 18px',
    marginBottom: 18
  },
  introWhoLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#8a8275',
    fontWeight: 600,
    marginBottom: 12
  },
  introWhoList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  introWhoItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12
  },
  introWhoIcon: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: '#efeadd',
    color: '#1a1a1a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    flexShrink: 0,
    marginTop: 1
  },
  introWhoText: {
    fontSize: 13,
    color: '#1a1a1a',
    lineHeight: 1.5
  },
  introDemoBox: {
    background: '#fdf5e9',
    border: '1px solid #efd9a8',
    borderRadius: 12,
    padding: '12px 14px',
    marginBottom: 24
  },
  introDemoLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#a37b1a',
    fontWeight: 600,
    marginBottom: 6
  },
  introDemoText: {
    fontSize: 12,
    color: '#5a564d',
    lineHeight: 1.55,
    margin: 0
  },
  introCta: {
    background: '#1a1a1a',
    color: '#f5f1e8',
    border: 'none',
    borderRadius: 100,
    padding: '16px 32px',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
    width: '100%'
  },
  introFoot: {
    marginTop: 22,
    fontSize: 11,
    color: '#8a8275',
    letterSpacing: '0.08em',
    textAlign: 'center'
  },

  // ===== Feedback widget =====
  feedbackFloater: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    background: '#1a1a1a',
    color: '#f5f1e8',
    border: '1px solid #1a1a1a',
    borderRadius: 100,
    padding: '11px 18px',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 4px 16px -2px rgba(0,0,0,0.25), 0 2px 4px -1px rgba(0,0,0,0.12)',
    zIndex: 50,
    transition: 'transform 0.15s ease'
  },
  feedbackFloaterText: {
    display: 'inline-block'
  },
  feedbackBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 220,
    background: 'rgba(20, 18, 14, 0.4)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: 16,
    animation: 'fadein 0.18s ease'
  },
  feedbackSheet: {
    width: '100%',
    maxWidth: 460,
    background: '#fdfbf5',
    borderRadius: 20,
    boxShadow: '0 -8px 40px -8px rgba(0,0,0,0.32), 0 -2px 8px -2px rgba(0,0,0,0.14)',
    border: '1px solid #e8e4dc',
    padding: '14px 0 8px',
    animation: 'sheetin 0.25s cubic-bezier(.22,.91,.34,1)'
  },
  feedbackBody: {
    padding: '4px 20px 20px'
  },
  feedbackHead: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    paddingBottom: 16
  },
  feedbackTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18,
    fontWeight: 500,
    color: '#1a1a1a',
    letterSpacing: '-0.01em',
    lineHeight: 1.2
  },
  feedbackSubtitle: {
    fontSize: 12,
    color: '#5a564d',
    marginTop: 4,
    lineHeight: 1.5
  },
  feedbackCatLabel: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: '#5a564d',
    fontWeight: 600,
    marginBottom: 8,
    marginTop: 4
  },
  feedbackCatGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginBottom: 18
  },
  feedbackCatBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#fdfbf5',
    border: '1px solid #e8e4dc',
    borderRadius: 10,
    padding: '10px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    width: '100%',
    transition: 'border-color 0.15s ease'
  },
  feedbackCatBtnActive: {
    borderColor: '#1a1a1a',
    background: '#fdfbf5'
  },
  feedbackCatEmoji: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: '#efeadd',
    color: '#1a1a1a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    flexShrink: 0
  },
  feedbackCatLabelInner: {
    fontSize: 13,
    color: '#1a1a1a'
  },
  feedbackTextarea: {
    width: '100%',
    padding: '12px 14px',
    background: '#fdfbf5',
    border: '1px solid #e0d9c8',
    borderRadius: 10,
    fontSize: 13,
    color: '#1a1a1a',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    resize: 'vertical',
    boxSizing: 'border-box',
    marginBottom: 14
  },
  feedbackSendBtn: {
    width: '100%',
    background: '#1a1a1a',
    color: '#f5f1e8',
    border: 'none',
    borderRadius: 100,
    padding: '13px 28px',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.06em',
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  feedbackNote: {
    fontSize: 11,
    color: '#8a8275',
    margin: '10px 0 0 0',
    fontStyle: 'italic',
    textAlign: 'center'
  },
  feedbackSent: {
    padding: '32px 20px 36px',
    textAlign: 'center'
  },
  feedbackSentIcon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#1a1a1a',
    color: '#f5f1e8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    margin: '0 auto 16px'
  },
  feedbackSentTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 22,
    fontWeight: 500,
    color: '#1a1a1a',
    letterSpacing: '-0.01em',
    marginBottom: 8
  },
  feedbackSentText: {
    fontSize: 13,
    color: '#5a564d',
    lineHeight: 1.5
  },
  feedbackEmailChip: {
    display: 'inline-block',
    marginTop: 12,
    padding: '8px 14px',
    background: '#1a1a1a',
    color: '#f5f1e8',
    borderRadius: 100,
    fontSize: 13,
    fontWeight: 500,
    userSelect: 'all'
  },

  // ===== ATHLETE SWITCHER MODAL =====
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(26, 26, 26, 0.4)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 100,
    animation: 'fadein 0.2s ease',
    padding: 20
  },
  modalCard: {
    background: '#f5f1e8',
    borderRadius: 20,
    width: '100%',
    maxWidth: 420,
    padding: '24px 22px 28px',
    maxHeight: '85vh',
    overflowY: 'auto',
    boxShadow: '0 -8px 40px -12px rgba(0,0,0,0.3)',
    border: '1px solid #e8e4dc'
  },
  modalHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  modalKicker: {
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: '#c8472b',
    fontWeight: 600,
    marginBottom: 4
  },
  modalKicker2: {
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: '#8a8275',
    fontWeight: 600,
    margin: '20px 0 8px'
  },
  modalTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 24,
    fontWeight: 400,
    letterSpacing: '-0.02em',
    color: '#1a1a1a'
  },
  modalClose: {
    background: 'transparent',
    border: 'none',
    color: '#8a8275',
    cursor: 'pointer',
    padding: 4
  },
  modalIntro: {
    fontSize: 13,
    color: '#5a564d',
    lineHeight: 1.5,
    margin: '4px 0 18px'
  },
  athletePick: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: '#fdfbf5',
    border: '1px solid #e8e4dc',
    borderRadius: 12,
    padding: '14px 16px',
    marginBottom: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s ease'
  },
  athletePickActive: {
    background: '#1a1a1a',
    borderColor: '#1a1a1a',
    color: '#f5f1e8'
  },
  athletePickName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 17,
    fontWeight: 500,
    marginBottom: 3,
    color: 'inherit'
  },
  athletePickMeta: {
    fontSize: 11,
    letterSpacing: '0.02em',
    opacity: 0.7,
    color: 'inherit'
  },

  // ===== DEMO STRIP IN ATHLETE APP =====
  demoStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#1a1a1a',
    color: '#f5f1e8',
    border: 'none',
    borderRadius: 8,
    padding: '8px 12px',
    marginBottom: 20,
    fontSize: 12,
    width: '100%',
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  demoStripFresh: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#fdfbf5',
    color: '#5a564d',
    border: '1px dashed #c8b894',
    borderRadius: 8,
    padding: '8px 12px',
    marginBottom: 20,
    fontSize: 12,
    width: '100%',
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  demoStripLabel: {
    fontSize: 9,
    letterSpacing: '0.16em',
    fontWeight: 600,
    opacity: 0.7
  },
  demoStripName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 14,
    letterSpacing: '-0.01em',
    flex: 1,
    textAlign: 'left'
  },
  demoStripSwitch: {
    fontSize: 11,
    opacity: 0.85,
    letterSpacing: '0.02em',
    marginLeft: 'auto'
  },

  // ===== VIEW TOGGLE =====
  viewToggle: {
    background: 'transparent',
    border: '1px solid #c8b894',
    borderRadius: 100,
    color: '#5a564d',
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: 600,
    padding: '6px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit'
  },

  // ===== Dual-mode switcher (for users with both athlete + staff identity) =====
  dualModeSwitcher: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 8,
    marginBottom: 18,
    background: '#efeadd',
    borderRadius: 14,
    padding: 4
  },
  dualModeBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'transparent', border: 'none',
    padding: '10px 10px', borderRadius: 10,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    color: '#5a564d',
    transition: 'all 0.15s ease',
    minWidth: 0
  },
  dualModeBtnActive: {
    background: '#fdfbf5',
    color: '#1a1a1a',
    boxShadow: '0 1px 2px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.5) inset'
  },
  dualModeBtnIcon: {
    fontSize: 18, lineHeight: 1, flexShrink: 0
  },
  dualModeBtnLabel: {
    fontSize: 12, fontWeight: 600, letterSpacing: '0.04em',
    lineHeight: 1.2
  },
  dualModeBtnSub: {
    fontSize: 10, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em',
    lineHeight: 1.35,
    wordBreak: 'break-word'
  },

  // ===== Roster group headers (for multi-club staff) =====
  rosterGroupHead: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    marginTop: 18, marginBottom: 10,
    paddingBottom: 6,
    borderBottom: '1px solid #e0d9c8'
  },
  rosterGroupLabel: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  rosterGroupCount: {
    fontSize: 10, color: '#8a8275',
    letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600
  },

  // ===== ATHLETE APP =====
  athleteFrame: {
    maxWidth: 420,
    margin: '0 auto',
    background: '#f5f1e8',
    minHeight: '90vh',
    borderRadius: 28,
    padding: '28px 24px 32px',
    boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 12px 40px -12px rgba(0,0,0,0.18)',
    border: '1px solid #e8e4dc',
    position: 'relative',
    animation: 'fadein 0.3s ease'
  },
  aTopBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24
  },
  aBody: {
    display: 'flex',
    flexDirection: 'column'
  },
  brandMark: { fontSize: 20, color: '#1a1a1a' },
  brandWord: {
    fontFamily: '"Fraunces", "Cormorant Garamond", Georgia, serif',
    fontSize: 17, fontWeight: 500, letterSpacing: '-0.01em', color: '#1a1a1a'
  },
  linkBtn: {
    background: 'transparent', border: 'none', color: '#8a8275',
    fontSize: 12, letterSpacing: '0.03em', cursor: 'pointer', padding: 4
  },
  aGreet: { marginBottom: 22 },
  aDay: {
    fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: '#8a8275', marginBottom: 6
  },
  aHello: {
    fontFamily: '"Fraunces", "Cormorant Garamond", Georgia, serif',
    fontSize: 30, fontWeight: 400, margin: 0, letterSpacing: '-0.02em',
    lineHeight: 1.1, color: '#1a1a1a'
  },

  aSection: { marginBottom: 18 },
  aSectionLabel: {
    fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: '#8a8275', marginBottom: 8
  },
  checkRow: {
    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
    padding: '14px 4px', background: 'transparent', border: 'none',
    borderBottom: '1px solid #e8e4dc', cursor: 'pointer',
    fontSize: 15, fontFamily: 'inherit'
  },

  aCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 18, padding: '16px 18px', marginBottom: 14
  },
  aCardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 6
  },
  aCardLabel: {
    fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600
  },
  aSub: { fontSize: 11, color: '#8a8275' },
  aSub2: { fontSize: 12, color: '#8a8275', marginTop: 4 },
  aBigNum: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 36, fontWeight: 400, letterSpacing: '-0.03em',
    lineHeight: 1, marginTop: 2
  },
  aUnit: { fontSize: 12, color: '#8a8275', marginLeft: 6, letterSpacing: '0.05em', fontFamily: 'Inter, sans-serif' },
  aPill: {
    fontSize: 10, letterSpacing: '0.06em', padding: '3px 9px',
    borderRadius: 100, fontWeight: 500
  },
  pillNeutral: { background: '#e8e4dc', color: '#1a1a1a' },
  pillWarn: { background: '#fae6df', color: '#9c3a23' },

  aRec: {
    background: '#1a1a1a', color: '#f5f1e8', borderRadius: 18,
    padding: '18px 20px', marginTop: 18
  },
  aRecLabel: {
    fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
    opacity: 0.6, marginBottom: 8
  },
  aRecText: {
    margin: 0, fontFamily: '"Fraunces", Georgia, serif', fontSize: 17,
    lineHeight: 1.4, fontWeight: 400, letterSpacing: '-0.005em'
  },

  aHistoryLink: {
    background: 'transparent', border: 'none', color: '#1a1a1a',
    fontSize: 13, marginTop: 18, cursor: 'pointer', padding: '8px 0',
    letterSpacing: '0.02em'
  },
  aBottomLinks: {
    display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', gap: 12, marginTop: 10
  },

  // ===== Athlete files screen =====
  aFilesIntro: {
    fontSize: 13, color: '#5a564d', lineHeight: 1.5, marginBottom: 16
  },
  aCtaBtn: {
    width: '100%', background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 12, padding: '14px 18px',
    fontSize: 14, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit', marginBottom: 16
  },
  aFileForm: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 14, padding: '16px 18px',
    display: 'flex', flexDirection: 'column', gap: 14,
    marginBottom: 16
  },
  aFileFormTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 500, letterSpacing: '-0.01em',
    color: '#1a1a1a'
  },
  aFileFormField: {
    display: 'flex', flexDirection: 'column', gap: 6
  },
  aFileLabel: {
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600
  },
  aFileInput: {
    width: '100%', padding: '10px 12px',
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 8, fontSize: 14, color: '#1a1a1a',
    fontFamily: 'inherit', boxSizing: 'border-box'
  },
  aFilePreview: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 8, padding: '10px 12px'
  },
  aFilePreviewName: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500
  },
  aFilePreviewMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 2
  },
  aPillRow: {
    display: 'flex', gap: 6, flexWrap: 'wrap'
  },
  aPillBtn: {
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 100, padding: '7px 14px',
    fontSize: 12, color: '#5a564d', cursor: 'pointer',
    fontFamily: 'inherit'
  },
  aPillBtnActive: {
    background: '#1a1a1a', borderColor: '#1a1a1a', color: '#f5f1e8'
  },
  aShareRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 0'
  },
  aShareHint: {
    fontSize: 11, color: '#8a8275', marginTop: 2,
    textTransform: 'none', letterSpacing: '0'
  },
  aToggle: {
    width: 42, height: 24, borderRadius: 100,
    border: 'none', cursor: 'pointer', position: 'relative',
    padding: 0, transition: 'background 0.2s ease',
    flexShrink: 0
  },
  aToggleKnob: {
    position: 'absolute', top: 2, left: 0,
    width: 20, height: 20, borderRadius: '50%',
    background: '#fdfbf5',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s ease'
  },
  aFileFormActions: {
    display: 'flex', gap: 10, marginTop: 6
  },
  aFileCancelBtn: {
    flex: 1, background: 'transparent', color: '#5a564d',
    border: '1px solid #c8b894', borderRadius: 8,
    padding: '12px', fontSize: 13, cursor: 'pointer',
    fontFamily: 'inherit'
  },
  aFileSaveBtn: {
    flex: 2, background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 8, padding: '12px',
    fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit'
  },
  aFileFilters: {
    display: 'flex', gap: 6, marginBottom: 12
  },
  aFileFilterBtn: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 100, padding: '6px 14px', fontSize: 11,
    color: '#5a564d', cursor: 'pointer', fontFamily: 'inherit',
    letterSpacing: '0.02em'
  },
  aFileFilterBtnActive: {
    background: '#1a1a1a', borderColor: '#1a1a1a', color: '#f5f1e8'
  },
  aFileList: {
    display: 'flex', flexDirection: 'column', gap: 8
  },
  aFileItem: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '12px 14px'
  },
  aFileItemName: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  },
  aFileItemMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 2
  },
  aFileStaffBadge: { color: '#5a564d' },
  aFileItemActions: {
    display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0
  },
  aFileBadge: {
    fontSize: 10, padding: '4px 8px', borderRadius: 100,
    letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit'
  },
  aFileDelete: {
    background: 'transparent', border: 'none', color: '#8a8275',
    cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center'
  },
  aFileStaffMarker: {
    fontSize: 9, color: '#8a8275', letterSpacing: '0.14em',
    textTransform: 'uppercase', flexShrink: 0
  },
  aFilesEmpty: {
    padding: '40px 20px', textAlign: 'center',
    color: '#8a8275', fontSize: 13, fontStyle: 'italic',
    background: '#fdfbf5', border: '1px dashed #c8b894',
    borderRadius: 12
  },

  // ===== Sub views =====
  subHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 18
  },
  subHeaderTitle: {
    fontFamily: '"Fraunces", Georgia, serif', fontSize: 18, fontWeight: 500
  },
  backBtn: {
    width: 32, height: 32, borderRadius: '50%',
    background: '#e8e4dc', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  subBody: { paddingBottom: 30 },
  fieldLabel: {
    fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600, marginTop: 22, marginBottom: 10
  },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: {
    padding: '7px 12px', borderRadius: 100, background: '#fdfbf5',
    border: '1px solid #e8e4dc', cursor: 'pointer', fontSize: 13, color: '#1a1a1a'
  },
  chipActive: { background: '#1a1a1a', color: '#f5f1e8', border: '1px solid #1a1a1a' },

  durRow: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 },
  durBtn: {
    padding: '10px 0', borderRadius: 10, background: '#fdfbf5',
    border: '1px solid #e8e4dc', cursor: 'pointer', fontSize: 13, fontWeight: 500
  },
  durBtnActive: { background: '#1a1a1a', color: '#f5f1e8', border: '1px solid #1a1a1a' },
  slider: { width: '100%', height: 4, background: '#e8e4dc', borderRadius: 4, outline: 'none' },
  sliderAccent: { width: '100%', height: 4, background: 'linear-gradient(to right, #e8e4dc, #c8472b)', borderRadius: 4, outline: 'none' },
  sliderVal: { textAlign: 'center', fontSize: 13, color: '#8a8275', marginTop: 4 },

  rpeBigNum: {
    fontFamily: '"Fraunces", Georgia, serif', fontSize: 64,
    fontWeight: 400, textAlign: 'center', margin: '8px 0 0',
    letterSpacing: '-0.04em', color: '#1a1a1a', lineHeight: 1
  },
  rpeDesc: { textAlign: 'center', color: '#8a8275', fontSize: 13, marginBottom: 14, fontStyle: 'italic' },
  rpeScale: { display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: '#b8b1a0', letterSpacing: '0.05em' },

  textInput: {
    width: '100%', padding: '12px 14px', borderRadius: 12,
    border: '1px solid #e8e4dc', background: '#fdfbf5',
    fontSize: 14, fontFamily: 'inherit', outline: 'none', color: '#1a1a1a'
  },

  primaryBtn: {
    width: '100%', padding: '16px', background: '#1a1a1a',
    color: '#f5f1e8', border: 'none', borderRadius: 14,
    fontSize: 15, fontWeight: 500, cursor: 'pointer',
    marginTop: 28, letterSpacing: '0.01em'
  },

  wHint: { fontSize: 13, color: '#8a8275', marginTop: -6, marginBottom: 12 },
  wField: { marginBottom: 20 },
  wFieldHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  wFieldLabel: { fontSize: 14, fontWeight: 500 },
  wFieldVal: {
    fontFamily: '"Fraunces", Georgia, serif', fontSize: 22,
    fontWeight: 400, letterSpacing: '-0.02em'
  },
  wFieldEnds: { display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: '#b8b1a0', letterSpacing: '0.04em', textTransform: 'uppercase' },

  histRow: { display: 'flex', gap: 14, padding: '14px 0', borderBottom: '1px solid #e8e4dc' },
  histRowTap: { cursor: 'pointer', borderRadius: 8, margin: '0 -8px', padding: '14px 8px' },
  histDate: { width: 78, fontSize: 11, color: '#8a8275', letterSpacing: '0.04em', textTransform: 'uppercase', paddingTop: 2 },
  histBody: { flex: 1 },
  histTitle: { fontSize: 14, fontWeight: 500 },
  histLoad: { fontFamily: '"Fraunces", Georgia, serif', fontSize: 15 },
  histMeta: { fontSize: 12, color: '#8a8275', marginTop: 2 },
  histTapHint: {
    fontSize: 10, color: '#b8b1a0', marginTop: 6,
    letterSpacing: '0.06em', textTransform: 'uppercase'
  },
  histEditedTag: {
    marginTop: 4, fontSize: 9, color: '#a37b1a',
    letterSpacing: '0.06em', textTransform: 'uppercase',
    fontWeight: 600
  },
  histAddPastBtn: {
    width: '100%',
    background: 'transparent', color: '#1a1a1a',
    border: '1px dashed #c8b894', borderRadius: 12,
    padding: '14px 16px',
    fontSize: 13, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
    marginBottom: 18
  },

  // ===== Athlete-side injuries =====
  aInjuriesIntro: {
    fontSize: 12, color: '#5a564d',
    lineHeight: 1.5, fontStyle: 'italic',
    margin: '0 0 18px 0'
  },
  aInjuriesGroupHead: {
    fontSize: 10, letterSpacing: '0.16em',
    textTransform: 'uppercase', color: '#8a8275', fontWeight: 600,
    marginBottom: 10
  },
  aInjCard: {
    background: '#fdfbf5',
    border: '1px solid #e8e4dc',
    borderRadius: 12,
    overflow: 'hidden'
  },
  aInjCardHead: {
    display: 'flex', alignItems: 'flex-start',
    padding: '14px 16px',
    background: 'transparent', border: 'none',
    width: '100%', textAlign: 'left',
    cursor: 'pointer', fontFamily: 'inherit'
  },
  aInjCardTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 15, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', lineHeight: 1.3
  },
  aInjCardMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 4,
    letterSpacing: '0.02em',
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap'
  },
  aInjSelfTag: {
    fontSize: 9, padding: '2px 7px',
    background: '#fdf5e9', color: '#a37b1a',
    border: '1px solid #efd9a8', borderRadius: 100,
    letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600
  },
  aInjCardBody: {
    padding: '4px 16px 16px',
    borderTop: '1px solid #efeadd'
  },
  aInjLabel: {
    fontSize: 10, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: '#8a8275', fontWeight: 600,
    marginBottom: 6
  },
  aInjValue: {
    fontSize: 13, color: '#1a1a1a', lineHeight: 1.5
  },
  aInjSubMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 4,
    fontStyle: 'italic'
  },
  aInjMilestones: {
    background: '#f5f1e8', borderRadius: 8,
    padding: '12px 12px',
    margin: '14px 0 0 0'
  },
  aInjMilestonesNote: {
    fontSize: 10, color: '#8a8275', marginTop: 8,
    fontStyle: 'italic', lineHeight: 1.5,
    textAlign: 'center'
  },

  // ===== Per-injury sharing =====
  aInjSharing: {
    marginTop: 18,
    paddingTop: 14,
    borderTop: '1px dashed #e0d9c8'
  },
  aInjSharingHead: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'transparent', border: 'none',
    width: '100%', padding: 0,
    cursor: 'pointer', fontFamily: 'inherit'
  },
  aInjSharingBody: {
    marginTop: 12
  },
  aInjSharingHint: {
    fontSize: 11, color: '#5a564d',
    lineHeight: 1.5, marginBottom: 12,
    fontStyle: 'italic'
  },
  aInjSharingRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid #efeadd'
  },
  aInjSharingName: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500
  },
  aInjSharingRole: {
    fontSize: 10, color: '#8a8275', marginTop: 2,
    letterSpacing: '0.02em'
  },
  aInjSharingOverrideTag: {
    fontStyle: 'italic', color: '#a37b1a'
  },

  // ===== Athlete injury report form =====
  aInjFormIntro: {
    fontSize: 13, color: '#5a564d',
    lineHeight: 1.55,
    padding: '12px 14px',
    background: '#fdf5e9', border: '1px solid #efd9a8',
    borderRadius: 8,
    margin: '0 0 18px 0'
  },
  aInjRegionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 6,
    marginBottom: 6
  },
  aInjRegionBtn: {
    background: '#fdfbf5', color: '#1a1a1a',
    border: '1px solid #e0d9c8', borderRadius: 10,
    padding: '11px 12px', fontSize: 12,
    cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'left'
  },
  aInjRegionBtnActive: {
    background: '#1a1a1a', color: '#f5f1e8',
    borderColor: '#1a1a1a', fontWeight: 600
  },
  aInjSideRow: {
    display: 'flex', gap: 6, flexWrap: 'wrap'
  },
  aInjSideBtn: {
    flex: 1, minWidth: '20%',
    background: '#fdfbf5', color: '#1a1a1a',
    border: '1px solid #e0d9c8', borderRadius: 100,
    padding: '10px 14px', fontSize: 12,
    cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap'
  },
  aInjSideBtnActive: {
    background: '#1a1a1a', color: '#f5f1e8',
    borderColor: '#1a1a1a', fontWeight: 600
  },
  aInjFormNote: {
    fontSize: 11, color: '#5a564d',
    fontStyle: 'italic', lineHeight: 1.5,
    padding: '10px 12px',
    background: '#f5f1e8', borderRadius: 8,
    margin: '18px 0 14px 0'
  },
  pastSessionHint: {
    fontSize: 12, color: '#a37b1a',
    fontStyle: 'italic', lineHeight: 1.5,
    padding: '8px 12px',
    background: '#fdf5e9', borderRadius: 6,
    margin: '8px 0 4px 0'
  },
  deleteConfirm: {
    marginTop: 18,
    padding: '14px 16px',
    background: '#fdf5f0', border: '1px solid #f0cbb8',
    borderRadius: 10
  },
  deleteConfirmText: {
    fontSize: 13, color: '#9c3a23',
    marginBottom: 12, lineHeight: 1.5
  },
  deleteConfirmActions: {
    display: 'flex', gap: 8
  },
  deleteConfirmCancel: {
    flex: 1,
    background: 'transparent', color: '#1a1a1a',
    border: '1px solid #c8b894', borderRadius: 100,
    padding: '10px 16px', fontSize: 13, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit'
  },
  deleteConfirmConfirm: {
    flex: 1,
    background: '#9c3a23', color: '#fdfbf5',
    border: 'none', borderRadius: 100,
    padding: '10px 16px', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit'
  },
  dangerLinkBtn: {
    background: 'transparent', color: '#9c3a23',
    border: 'none', padding: '14px 8px',
    fontSize: 12, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
    width: '100%', marginTop: 10,
    textDecoration: 'underline'
  },

  toast: {
    position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)',
    background: '#1a1a1a', color: '#f5f1e8', padding: '10px 16px',
    borderRadius: 100, fontSize: 13, display: 'flex', alignItems: 'center',
    gap: 6, animation: 'fadein 0.2s ease', zIndex: 10, whiteSpace: 'nowrap'
  },

  // ===== PRACTITIONER =====
  pFrame: {
    maxWidth: 1320,
    margin: '0 auto',
    background: '#f5f1e8',
    minHeight: '90vh',
    borderRadius: 16,
    padding: '24px 32px 40px',
    boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 12px 40px -12px rgba(0,0,0,0.18)',
    border: '1px solid #e8e4dc',
    animation: 'fadein 0.3s ease',
    overflow: 'hidden'
  },
  pHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: 20, borderBottom: '1px solid #e0d9c8', marginBottom: 24,
    gap: 12, flexWrap: 'wrap'
  },
  pHeaderDivider: { color: '#b8b1a0', fontSize: 22, fontWeight: 200 },
  pHeaderKicker: {
    fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#c8472b', fontWeight: 600, marginBottom: 4
  },
  pOrgName: {
    fontFamily: '"Fraunces", Georgia, serif', fontSize: 20,
    fontWeight: 500, letterSpacing: '-0.01em'
  },
  pOrgSub: { fontSize: 12, color: '#8a8275', marginTop: 2, letterSpacing: '0.02em' },

  pKpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14,
    marginBottom: 24
  },
  kpi: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '16px 18px',
    minWidth: 0
  },
  kpiAccent: { borderLeft: '3px solid #c8472b' },
  kpiLabel: {
    fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, marginBottom: 8,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
  },
  kpiValue: {
    fontFamily: '"Fraunces", Georgia, serif', fontSize: 28,
    fontWeight: 400, letterSpacing: '-0.02em', display: 'flex', alignItems: 'baseline',
    overflow: 'hidden'
  },
  kpiSub: { fontSize: 11, color: '#8a8275', marginTop: 4 },

  pFilters: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
    overflowX: 'auto', flexWrap: 'nowrap',
    paddingBottom: 4,
    WebkitOverflowScrolling: 'touch'
  },
  pFilterLabel: {
    fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, marginRight: 6,
    flexShrink: 0
  },
  pFilterBtn: {
    padding: '6px 12px', borderRadius: 6, background: 'transparent',
    border: '1px solid #e0d9c8', cursor: 'pointer', fontSize: 12, color: '#5a564d',
    fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0
  },
  pFilterBtnActive: { background: '#1a1a1a', color: '#f5f1e8', border: '1px solid #1a1a1a' },

  pTable: { background: '#fdfbf5', border: '1px solid #e8e4dc', borderRadius: 12, overflow: 'auto' },
  pTableHead: {
    display: 'flex', gap: 14, padding: '12px 18px',
    background: '#efeadd', borderBottom: '1px solid #e0d9c8',
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600,
    minWidth: 880
  },
  pTableRow: {
    display: 'flex', gap: 14, padding: '14px 18px',
    background: 'transparent', border: 'none', borderBottom: '1px solid #e8e4dc',
    cursor: 'pointer', textAlign: 'left', width: '100%', alignItems: 'center',
    minWidth: 880
  },
  pAthName: { fontSize: 14, fontWeight: 500, color: '#1a1a1a' },
  pAthMeta: { fontSize: 11, color: '#8a8275', marginTop: 2, letterSpacing: '0.02em' },
  pCell: { fontFamily: '"Fraunces", Georgia, serif', fontSize: 16, fontWeight: 400 },
  pUnit: { fontSize: 10, color: '#8a8275', fontFamily: 'Inter, sans-serif', letterSpacing: '0.04em' },
  pSub: { fontSize: 10, color: '#8a8275', marginTop: 2 },
  pNoFlag: { color: '#b8b1a0', fontSize: 14 },
  pFlag: {
    fontSize: 10, padding: '3px 8px', borderRadius: 4,
    background: '#efeadd', color: '#5a564d', letterSpacing: '0.02em',
    border: '1px solid #e0d9c8'
  },
  pFlagWarn: { background: '#fae6df', color: '#9c3a23', border: '1px solid #f0cbb8' },

  // ===== ATHLETE CARDS (replaces table) =====
  aList: {
    display: 'flex', flexDirection: 'column', gap: 10
  },
  pAthCard: {
    background: '#fdfbf5',
    border: '1px solid #e8e4dc',
    borderRadius: 10,
    padding: '14px 16px',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: 'inherit',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    transition: 'border-color 0.15s ease',
    width: '100%'
  },
  aCardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12
  },
  aCardLeft: { flex: 1, minWidth: 0 },
  aCardRight: { flexShrink: 0 },
  aCardNameRow: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2
  },
  aTrafficDot: {
    width: 10, height: 10, borderRadius: '50%',
    flexShrink: 0,
    boxShadow: '0 0 0 2px #fdfbf5'
  },
  aCardName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 17, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  aCardMeta: {
    fontSize: 11, color: '#8a8275', letterSpacing: '0.02em',
    paddingLeft: 18
  },
  aInjNote: { color: '#c8472b', fontWeight: 500 },

  aCardStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
    paddingTop: 10,
    borderTop: '1px solid #efeadd'
  },
  aStat: { minWidth: 0 },
  aStatLabel: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, marginBottom: 4
  },
  aStatValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em'
  },
  aStatUnit: {
    fontSize: 10, color: '#8a8275', fontFamily: 'Inter, sans-serif',
    letterSpacing: '0.04em', marginLeft: 2
  },

  aCardFoot: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
    flexWrap: 'wrap'
  },
  aFlagRow: {
    display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1
  },
  aLastSession: {
    fontSize: 10, color: '#8a8275', letterSpacing: '0.04em',
    fontStyle: 'italic'
  },

  // ===== INJURY BANNER (athlete detail) =====
  injBanner: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderLeft: '3px solid #d4a017',
    borderRadius: 8, padding: '12px 14px', marginBottom: 16
  },
  injBannerDot: {
    width: 10, height: 10, borderRadius: '50%',
    marginTop: 5, flexShrink: 0
  },
  injBannerLabel: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 15, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  injBannerNote: {
    fontSize: 12, color: '#5a564d', marginTop: 2
  },

  // ===== PERFORMANCE / VIEW MODE =====
  pViewTabs: {
    display: 'flex', gap: 6, marginBottom: 18,
    background: '#efeadd', borderRadius: 100, padding: 4,
    maxWidth: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    flexWrap: 'nowrap',
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    WebkitOverflowScrolling: 'touch'
  },
  pViewTab: {
    background: 'transparent', border: 'none',
    padding: '8px 16px', borderRadius: 100,
    fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: '#5a564d',
    cursor: 'pointer', fontFamily: 'inherit',
    transition: 'all 0.15s ease',
    flexShrink: 0,
    whiteSpace: 'nowrap'
  },
  pViewTabActive: {
    background: '#1a1a1a', color: '#f5f1e8'
  },

  perfSubTabs: {
    display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap'
  },

  // ===== Performance action bars =====
  perfActionBar: {
    marginBottom: 14
  },
  perfActionPrimary: {
    background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 100, padding: '11px 18px',
    fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit', width: '100%'
  },
  testingActionRow: {
    display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4
  },
  testingActionPrimary: {
    background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 100, padding: '12px 18px',
    fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit',
    width: '100%'
  },
  testingActionSecondary: {
    background: 'transparent', color: '#1a1a1a',
    border: '1px solid #1a1a1a', borderRadius: 100, padding: '12px 18px',
    fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit',
    width: '100%'
  },
  perfTeamActionBar: {
    marginBottom: 16,
    padding: '14px 16px',
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12,
    display: 'flex', flexDirection: 'column', gap: 8
  },
  perfTeamUploadBtn: {
    background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 100, padding: '12px 18px',
    fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit', width: '100%'
  },
  perfSubTab: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 100, padding: '7px 14px', fontSize: 12,
    color: '#5a564d', cursor: 'pointer', fontFamily: 'inherit',
    letterSpacing: '0.02em'
  },
  perfSubTabActive: {
    background: '#1a1a1a', color: '#f5f1e8', borderColor: '#1a1a1a'
  },

  perfPanel: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '18px 20px'
  },
  perfPanelHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12, paddingBottom: 10,
    borderBottom: '1px solid #efeadd'
  },
  perfPanelLabel: {
    fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600
  },
  perfPanelCount: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, color: '#1a1a1a'
  },

  perfEmpty: {
    padding: '20px 10px', textAlign: 'center', color: '#8a8275',
    fontSize: 13, fontStyle: 'italic'
  },

  perfRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', background: '#f5f1e8',
    border: '1px solid transparent', borderRadius: 8,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    width: '100%'
  },
  perfRowName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 15, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  perfRowMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 2, letterSpacing: '0.02em'
  },
  perfRowRight: {
    textAlign: 'right', flexShrink: 0
  },
  perfRtpLabel: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600
  },
  perfRtpValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 14, marginTop: 2
  },

  perfTestRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', background: '#f5f1e8',
    border: '1px solid transparent', borderRadius: 8,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    width: '100%'
  },
  perfTestName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 14, fontWeight: 500, color: '#1a1a1a'
  },
  perfTestValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em',
    color: '#1a1a1a'
  },
  perfTestUnit: {
    fontSize: 10, color: '#8a8275', fontFamily: 'Inter, sans-serif',
    letterSpacing: '0.04em', marginLeft: 3
  },

  perfFileRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', background: '#f5f1e8',
    border: '1px solid transparent', borderRadius: 8,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    width: '100%'
  },
  perfFileCard: {
    display: 'flex', alignItems: 'center', gap: 12,
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 8, padding: '12px 14px',
    width: '100%', textAlign: 'left'
  },
  perfFileName: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500
  },

  perfStatLine: {
    display: 'flex', justifyContent: 'space-between',
    padding: '6px 0', fontSize: 13, color: '#5a564d'
  },
  perfStatValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, color: '#1a1a1a'
  },

  // ===== Test deviation flag =====
  testFlagPanel: {
    display: 'flex', gap: 10, alignItems: 'flex-start',
    padding: '10px 12px',
    background: '#fdf5f0',
    border: '1px solid #f0cbb8',
    borderRadius: 8,
    marginBottom: 12
  },
  testFlagIcon: {
    color: '#9c3a23',
    flexShrink: 0,
    marginTop: 1
  },
  testFlagTitle: {
    fontSize: 12, color: '#9c3a23', fontWeight: 600,
    marginBottom: 3
  },
  testFlagBody: {
    fontSize: 11, color: '#5a564d',
    lineHeight: 1.5
  },

  perfInjCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '14px 16px',
    width: '100%', textAlign: 'left'
  },
  perfInjHead: {
    display: 'flex', alignItems: 'flex-start'
  },
  // ===== Injury collaborative editing =====
  injStatusEdit: {
    background: '#fdfbf5',
    border: '1px solid #e8e4dc',
    borderRadius: 10,
    padding: '12px 14px',
    margin: '14px 0'
  },
  injStatusEditLabel: {
    fontSize: 10, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: '#8a8275', fontWeight: 600,
    marginBottom: 8
  },
  injStatusEditRow: {
    display: 'flex', gap: 6
  },
  injStatusBtn: {
    flex: 1,
    background: 'transparent', color: '#5a564d',
    border: '1px solid #e0d9c8', borderRadius: 100,
    padding: '8px 12px', fontSize: 11, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap'
  },
  injStatusBtnActive: {
    background: '#1a1a1a', color: '#f5f1e8', borderColor: '#1a1a1a',
    fontWeight: 600
  },
  injStatusMeta: {
    fontSize: 10, color: '#8a8275',
    marginTop: 8, fontStyle: 'italic'
  },

  perfInjGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
    gap: 10
  },
  perfInjLabel: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600
  },
  perfInjVal: {
    fontSize: 12, color: '#1a1a1a', marginTop: 2
  },
  perfDetailText: {
    fontSize: 13, color: '#1a1a1a', lineHeight: 1.5
  },

  perfStatusBtn: {
    background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 8, padding: '8px 14px',
    fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit'
  },

  perfAddBtn: {
    background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 8, padding: '12px 16px',
    fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit',
    width: '100%', textAlign: 'center'
  },
  perfAddBtnGhost: {
    background: 'transparent', color: '#5a564d',
    border: '1px solid #c8b894', borderRadius: 8,
    padding: '10px 14px', fontSize: 12, fontWeight: 600,
    letterSpacing: '0.04em', cursor: 'pointer',
    fontFamily: 'inherit', width: '100%'
  },

  perfBadgeGreen: {
    background: '#e7f1e3', color: '#3a8a4d',
    fontSize: 10, padding: '3px 8px', borderRadius: 4,
    letterSpacing: '0.06em', fontWeight: 600, textTransform: 'uppercase'
  },

  // baseline grid
  baselineGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 10, margin: '12px 0'
  },
  baselineCell: {
    background: '#f5f1e8', borderRadius: 8, padding: '10px 12px'
  },
  baselineLabel: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600
  },
  baselineValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 20, fontWeight: 400, marginTop: 2, color: '#1a1a1a'
  },
  baselineMax: {
    fontSize: 12, color: '#8a8275', fontFamily: 'Inter, sans-serif',
    marginLeft: 2
  },

  // forms
  perfFormCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '18px 20px',
    display: 'flex', flexDirection: 'column', gap: 14
  },
  perfFormTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 20, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', marginBottom: 4
  },
  perfFormField: {
    display: 'flex', flexDirection: 'column', gap: 6
  },
  perfFormLabel: {
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600
  },
  perfFormActions: {
    display: 'flex', gap: 10, marginTop: 8
  },
  perfCancelBtn: {
    flex: 1, background: 'transparent', color: '#5a564d',
    border: '1px solid #c8b894', borderRadius: 8,
    padding: '12px', fontSize: 13, cursor: 'pointer',
    fontFamily: 'inherit'
  },
  perfSaveBtn: {
    flex: 2, background: '#1a1a1a', color: '#f5f1e8',
    border: 'none', borderRadius: 8, padding: '12px',
    fontSize: 13, fontWeight: 600, letterSpacing: '0.04em',
    cursor: 'pointer', fontFamily: 'inherit'
  },
  perfSelect: {
    width: '100%', padding: '10px 12px',
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 8, fontSize: 14, color: '#1a1a1a',
    fontFamily: 'inherit'
  },
  perfInput: {
    width: '100%', padding: '10px 12px',
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 8, fontSize: 14, color: '#1a1a1a',
    fontFamily: 'inherit', boxSizing: 'border-box'
  },
  perfNumInput: {
    width: '100%', padding: '8px 10px',
    background: '#fdfbf5', border: '1px solid #e0d9c8',
    borderRadius: 6, fontSize: 14, color: '#1a1a1a',
    fontFamily: '"Fraunces", Georgia, serif',
    boxSizing: 'border-box', marginTop: 4
  },
  perfTextarea: {
    width: '100%', padding: '10px 12px',
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 8, fontSize: 14, color: '#1a1a1a',
    fontFamily: 'inherit', boxSizing: 'border-box',
    resize: 'vertical'
  },
  perfBtnRow: {
    display: 'flex', gap: 6, flexWrap: 'wrap'
  },
  perfPillBtn: {
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 100, padding: '7px 14px',
    fontSize: 12, color: '#5a564d', cursor: 'pointer',
    fontFamily: 'inherit'
  },
  perfPillBtnActive: {
    background: '#1a1a1a', borderColor: '#1a1a1a', color: '#f5f1e8'
  },

  // ===== Profile panel =====
  profilePanel: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '18px 20px',
    display: 'flex', flexDirection: 'column', gap: 14
  },
  profileHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: 10, borderBottom: '1px solid #efeadd'
  },
  profileLabel: {
    fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600
  },
  profileMedToggle: {
    background: 'transparent', border: '1px solid #c8b894',
    borderRadius: 100, padding: '5px 11px', fontSize: 10,
    color: '#5a564d', cursor: 'pointer', fontFamily: 'inherit',
    letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600
  },
  profileMedToggleActive: {
    background: '#9c3a23', borderColor: '#9c3a23', color: '#f5f1e8'
  },
  profileMedLocked: {
    background: 'transparent', border: '1px solid #c8b894',
    borderRadius: 100, padding: '5px 11px', fontSize: 10,
    color: '#8a8275', fontFamily: 'inherit',
    letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600
  },
  injMedicalLocked: {
    marginTop: 12, padding: '10px 12px',
    background: '#f5f1e8', border: '1px dashed #c8b894',
    borderRadius: 8,
    fontSize: 11, color: '#8a8275',
    letterSpacing: '0.04em', textAlign: 'center', fontStyle: 'italic'
  },

  // ===== Access blocked card =====
  accessBlocked: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '36px 24px',
    textAlign: 'center',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: 10
  },
  accessBlockedIcon: {
    fontSize: 34, color: '#8a8275', lineHeight: 1
  },
  accessBlockedTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  accessBlockedBody: {
    fontSize: 13, color: '#5a564d', lineHeight: 1.5,
    margin: 0, maxWidth: 320
  },
  accessBlockedTag: {
    marginTop: 6, fontSize: 10,
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 100, padding: '4px 12px',
    color: '#5a564d', letterSpacing: '0.06em',
    textTransform: 'uppercase', fontWeight: 600
  },
  profileSection: {
    display: 'flex', flexDirection: 'column', gap: 6
  },
  profileSectionLabel: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, marginBottom: 4
  },
  profileRow: {
    display: 'flex', gap: 12, fontSize: 13,
    padding: '4px 0'
  },
  profileRowLabel: {
    color: '#8a8275', flexShrink: 0, minWidth: 100, fontSize: 12
  },
  profileRowValue: {
    color: '#1a1a1a', flex: 1, wordBreak: 'break-word'
  },
  profileMedSection: {
    background: '#fdf5f0', border: '1px solid #f0cbb8',
    borderRadius: 8, padding: 12, gap: 4
  },
  profileMedHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 6
  },
  profileMedLabel: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#9c3a23', fontWeight: 600
  },
  profileMedTag: {
    fontSize: 9, padding: '2px 8px', borderRadius: 100,
    background: '#9c3a23', color: '#f5f1e8',
    letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600
  },
  profileMedHidden: {
    fontSize: 11, color: '#8a8275', fontStyle: 'italic',
    padding: '10px 12px', background: '#f5f1e8',
    border: '1px dashed #c8b894', borderRadius: 8,
    textAlign: 'center'
  },
  profileNotes: {
    fontSize: 13, color: '#1a1a1a', lineHeight: 1.5,
    padding: 10, background: '#f5f1e8', borderRadius: 8
  },

  // ===== Testing widget =====
  testWidget: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '18px 20px'
  },
  testWidgetHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid #efeadd'
  },
  testWidgetLabel: {
    fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600
  },
  testWidgetCount: {
    fontSize: 11, color: '#8a8275', letterSpacing: '0.02em'
  },
  testWidgetGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10
  },
  testWidgetCell: {
    background: '#f5f1e8', borderRadius: 8, padding: '10px 12px'
  },
  testWidgetCellLabel: {
    fontSize: 10, letterSpacing: '0.06em', color: '#5a564d',
    fontWeight: 600
  },
  testWidgetCellValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em',
    marginTop: 2, color: '#1a1a1a'
  },
  testWidgetCellUnit: {
    fontSize: 11, color: '#8a8275', fontFamily: 'Inter, sans-serif',
    letterSpacing: '0.04em', marginLeft: 3
  },
  testWidgetCellMeta: {
    fontSize: 10, color: '#8a8275', marginTop: 4,
    letterSpacing: '0.02em'
  },
  testWidgetEmpty: {
    padding: '20px 10px', textAlign: 'center', color: '#8a8275',
    fontSize: 13, fontStyle: 'italic'
  },

  // ===== Collapsible sections (for the big injury form) =====
  collapseSection: {
    border: '1px solid #e8e4dc', borderRadius: 10,
    overflow: 'hidden', background: '#f5f1e8'
  },
  collapseHead: {
    width: '100%', display: 'flex', justifyContent: 'space-between',
    alignItems: 'center', padding: '12px 14px',
    background: 'transparent', border: 'none', cursor: 'pointer',
    textAlign: 'left', fontFamily: 'inherit'
  },
  collapseKicker: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, marginBottom: 2
  },
  collapseTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  collapseBody: {
    padding: '4px 14px 16px',
    display: 'flex', flexDirection: 'column', gap: 14,
    background: '#fdfbf5', borderTop: '1px solid #e8e4dc'
  },

  // ===== RTP progress bar =====
  rtpBar: {
    display: 'flex', gap: 3, height: 8, borderRadius: 100,
    overflow: 'hidden'
  },
  rtpBarSegment: {
    flex: 1, transition: 'background 0.3s ease'
  },

  injSubHead: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600,
    marginTop: 14, marginBottom: 4,
    paddingTop: 10, borderTop: '1px solid #efeadd'
  },

  athleteUploadBadge: {
    background: '#fdf5f0', color: '#9c3a23',
    fontSize: 9, padding: '3px 8px', borderRadius: 100,
    letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
    border: '1px solid #f0cbb8', flexShrink: 0
  },

  // ===== Test summary cards (team-level) =====
  testSummaryCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '14px 16px',
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    width: '100%', display: 'flex', flexDirection: 'column', gap: 12
  },
  testSummaryTop: {
    display: 'flex', alignItems: 'flex-start', gap: 10
  },
  testSummaryName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', marginBottom: 2
  },
  testSummaryMeta: {
    fontSize: 11, color: '#8a8275', letterSpacing: '0.02em'
  },
  testSummaryStats: {
    display: 'flex', alignItems: 'center', gap: 16,
    paddingTop: 10, borderTop: '1px solid #efeadd'
  },
  testSummaryStatMain: {
    flex: 1
  },
  testSummaryStatLabel: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600
  },
  testSummaryStatValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 26, fontWeight: 400, letterSpacing: '-0.02em',
    marginTop: 2, color: '#1a1a1a', lineHeight: 1
  },
  testSummaryStatUnit: {
    fontSize: 12, color: '#8a8275', fontFamily: 'Inter, sans-serif',
    letterSpacing: '0.04em', marginLeft: 3
  },
  testSummaryStatSpread: {
    display: 'flex', flexDirection: 'column', gap: 4,
    paddingLeft: 16, borderLeft: '1px solid #efeadd'
  },
  testSummarySpreadRow: {
    display: 'flex', justifyContent: 'space-between', gap: 14,
    fontSize: 11
  },
  testSummarySpreadLabel: {
    color: '#8a8275', textTransform: 'uppercase', letterSpacing: '0.06em',
    fontWeight: 600, fontSize: 9
  },
  testSummarySpreadValue: {
    color: '#1a1a1a', fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 13
  },

  // Test drill-down
  testDrillBack: {
    background: 'transparent', border: 'none',
    color: '#5a564d', fontSize: 12, padding: '4px 0',
    cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', gap: 6,
    marginBottom: 12, letterSpacing: '0.02em'
  },
  testDrillHead: {
    paddingBottom: 14, borderBottom: '1px solid #efeadd', marginBottom: 14
  },
  testDrillKicker: {
    fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, marginBottom: 4
  },
  testDrillTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 22, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', marginBottom: 6
  },
  testDrillBrief: {
    fontSize: 12, color: '#5a564d', lineHeight: 1.5
  },
  testDrillSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10
  },
  testDrillSummaryCell: {
    background: '#f5f1e8', borderRadius: 8, padding: '10px 12px'
  },
  testDrillSummaryValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em',
    marginTop: 2, color: '#1a1a1a', lineHeight: 1.1
  },
  testDrillRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 14px',
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'left', width: '100%'
  },
  testDrillRank: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, color: '#8a8275', minWidth: 24, textAlign: 'center'
  },
  testDrillAthName: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 15, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  testDrillAthMeta: {
    fontSize: 11, color: '#8a8275', marginTop: 2, letterSpacing: '0.02em'
  },
  testDrillResult: {
    textAlign: 'right', flexShrink: 0
  },
  testDrillValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 18, fontWeight: 400, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  testDrillDelta: {
    fontSize: 10, marginTop: 2, letterSpacing: '0.02em'
  },
  testDrillNote: {
    fontSize: 12, color: '#5a564d', marginTop: 6, lineHeight: 1.4
  },
  testDrillNoteAuthor: {
    fontWeight: 600, color: '#1a1a1a'
  },

  // ===== Upload wizard =====
  uploadCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '18px 20px',
    display: 'flex', flexDirection: 'column', gap: 14
  },
  uploadHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingBottom: 12, borderBottom: '1px solid #efeadd'
  },
  uploadKicker: {
    fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#c8472b', fontWeight: 600, marginBottom: 4
  },
  uploadTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 22, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em'
  },
  uploadCancelX: {
    background: 'transparent', border: 'none',
    color: '#8a8275', cursor: 'pointer', padding: 4
  },
  uploadIntro: {
    fontSize: 13, color: '#5a564d', lineHeight: 1.5
  },
  uploadVendorChips: {
    display: 'flex', gap: 6, flexWrap: 'wrap',
    paddingBottom: 4
  },
  uploadVendorChip: {
    fontSize: 10, letterSpacing: '0.04em',
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 100, padding: '3px 9px',
    color: '#5a564d'
  },
  uploadDropArea: {
    border: '2px dashed #c8b894',
    borderRadius: 14, padding: '32px 20px',
    textAlign: 'center', cursor: 'pointer',
    background: '#f5f1e8',
    transition: 'border-color 0.15s ease',
    display: 'block'
  },
  uploadDropIcon: {
    fontSize: 32, color: '#5a564d', marginBottom: 8, lineHeight: 1
  },
  uploadDropMain: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 16, color: '#1a1a1a', marginBottom: 4,
    letterSpacing: '-0.01em'
  },
  uploadDropSub: {
    fontSize: 11, color: '#8a8275', letterSpacing: '0.02em'
  },
  uploadError: {
    background: '#fdf5f0', border: '1px solid #f0cbb8',
    borderLeft: '3px solid #c8472b',
    borderRadius: 8, padding: '10px 14px',
    fontSize: 12, color: '#9c3a23'
  },
  uploadActions: {
    display: 'flex', gap: 10, marginTop: 6
  },
  uploadFileBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 8, padding: '8px 12px',
    fontSize: 12, color: '#5a564d'
  },
  uploadFileBarName: {
    flex: 1, minWidth: 0, color: '#1a1a1a',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  },
  uploadFileBarMeta: {
    fontSize: 10, color: '#8a8275', letterSpacing: '0.04em',
    flexShrink: 0
  },
  uploadVendorPicker: {
    display: 'flex', flexDirection: 'column', gap: 6
  },
  uploadVendorLabel: {
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600
  },
  uploadVendorDesc: {
    fontSize: 11, color: '#8a8275', fontStyle: 'italic'
  },
  uploadMappingHead: {
    display: 'grid', gridTemplateColumns: '1fr auto 1fr',
    gap: 8, alignItems: 'center',
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600,
    paddingBottom: 6, borderBottom: '1px solid #efeadd'
  },
  uploadMappingList: {
    display: 'flex', flexDirection: 'column', gap: 8,
    maxHeight: '50vh', overflowY: 'auto',
    paddingRight: 4
  },
  uploadMappingRow: {
    display: 'grid', gridTemplateColumns: '1fr auto 1fr',
    gap: 8, alignItems: 'center'
  },
  uploadMappingHeader: {
    minWidth: 0
  },
  uploadMappingHeaderName: {
    fontSize: 12, color: '#1a1a1a', fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  },
  uploadMappingHeaderSample: {
    fontSize: 10, color: '#8a8275', marginTop: 2,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
  },
  uploadMappingSelect: {
    padding: '6px 8px',
    background: '#f5f1e8', border: '1px solid #e0d9c8',
    borderRadius: 6, fontSize: 11, color: '#1a1a1a',
    fontFamily: 'inherit', minWidth: 0
  },
  uploadSummary: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
    gap: 10
  },
  uploadSummaryCell: {
    background: '#f5f1e8', borderRadius: 8, padding: '10px 12px'
  },
  uploadSummaryLabel: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600
  },
  uploadSummaryValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 26, fontWeight: 400, marginTop: 2,
    color: '#1a1a1a', lineHeight: 1
  },
  uploadSummarySub: {
    fontSize: 10, color: '#8a8275', marginTop: 2, letterSpacing: '0.02em'
  },
  uploadWarnPanel: {
    background: '#fdf5f0', border: '1px solid #f0cbb8',
    borderLeft: '3px solid #c8472b',
    borderRadius: 8, padding: '12px 14px'
  },
  uploadWarnTitle: {
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#9c3a23', fontWeight: 600, marginBottom: 4
  },
  uploadWarnBody: {
    fontSize: 12, color: '#5a564d', lineHeight: 1.4
  },
  uploadFieldsPanel: {
    background: '#f5f1e8', borderRadius: 8, padding: '12px 14px'
  },
  uploadFieldsHead: {
    fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600, marginBottom: 8
  },
  uploadFieldsList: {
    display: 'flex', gap: 4, flexWrap: 'wrap'
  },
  uploadFieldChip: {
    fontSize: 10, letterSpacing: '0.02em',
    background: '#fdfbf5', border: '1px solid #e0d9c8',
    borderRadius: 100, padding: '3px 9px',
    color: '#1a1a1a', fontFamily: 'Consolas, monospace'
  },
  uploadOverwritePanel: {
    background: '#f5f1e8', borderRadius: 8, padding: '12px 14px'
  },
  uploadPreview: {
    background: '#f5f1e8', borderRadius: 8, padding: '12px 14px',
    display: 'flex', flexDirection: 'column', gap: 8
  },
  uploadPreviewRow: {
    background: '#fdfbf5', borderRadius: 6, padding: '8px 10px'
  },
  uploadPreviewRowHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline'
  },
  uploadPreviewRowName: {
    fontSize: 13, color: '#1a1a1a', fontWeight: 500
  },
  uploadPreviewRowDate: {
    fontSize: 11, color: '#8a8275'
  },
  uploadPreviewRowMeta: {
    fontSize: 11, color: '#5a564d', marginTop: 3, fontFamily: 'Consolas, monospace'
  },
  uploadDoneIcon: {
    fontSize: 40, color: '#3a8a4d', textAlign: 'center', marginTop: 8
  },
  uploadDoneTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 22, fontWeight: 500, color: '#1a1a1a',
    textAlign: 'center', letterSpacing: '-0.01em'
  },
  uploadDoneBody: {
    fontSize: 13, color: '#5a564d', textAlign: 'center',
    lineHeight: 1.6
  },

  // Hero in UploadDataSection
  uploadHeroLabel: {
    fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#c8472b', fontWeight: 600, marginBottom: 4
  },
  uploadHeroTitle: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 22, fontWeight: 500, color: '#1a1a1a',
    letterSpacing: '-0.01em', marginBottom: 8
  },
  uploadHeroBody: {
    fontSize: 13, color: '#5a564d', lineHeight: 1.5, marginBottom: 14
  },
  uploadSummaryGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
    gap: 10
  },
  uploadSummaryCellLarge: {
    background: '#f5f1e8', borderRadius: 8, padding: '12px 14px'
  },
  uploadSummaryLargeValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 26, fontWeight: 400, marginTop: 4,
    color: '#1a1a1a', lineHeight: 1, letterSpacing: '-0.02em'
  },
  uploadHistoryRow: {
    padding: '8px 0', borderBottom: '1px solid #efeadd'
  },
  uploadRecentRow: {
    background: '#f5f1e8', borderRadius: 8, padding: '10px 12px'
  },

  // ===== GPS Widget =====
  gpsWidget: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 12, padding: '18px 20px',
    display: 'flex', flexDirection: 'column', gap: 14
  },
  gpsWidgetHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: 10, borderBottom: '1px solid #efeadd'
  },
  gpsBigGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 10
  },
  gpsBigCell: {
    background: '#f5f1e8', borderRadius: 8, padding: '12px 14px'
  },
  gpsBigValue: {
    fontFamily: '"Fraunces", Georgia, serif',
    fontSize: 24, fontWeight: 400, marginTop: 4,
    color: '#1a1a1a', lineHeight: 1, letterSpacing: '-0.02em'
  },
  gpsSmallGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
    gap: 10
  },
  gpsSmallLabel: {
    fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600
  },
  gpsSmallValue: {
    fontSize: 14, color: '#1a1a1a', marginTop: 2,
    fontFamily: '"Fraunces", Georgia, serif',
    letterSpacing: '-0.01em'
  },
  gpsZonesBlock: {
    display: 'flex', flexDirection: 'column', gap: 6,
    paddingTop: 10, borderTop: '1px solid #efeadd'
  },
  gpsZonesBar: {
    display: 'flex', height: 10, borderRadius: 100,
    overflow: 'hidden', background: '#efeadd'
  },
  gpsZonesLegend: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 10, color: '#5a564d', letterSpacing: '0.04em'
  },
  gpsZoneLabel: {
    fontFamily: 'Consolas, monospace'
  },

  pFootnote: {
    fontSize: 11, color: '#8a8275', marginTop: 18, textAlign: 'center',
    letterSpacing: '0.02em', fontStyle: 'italic'
  },

  // ===== ATHLETE DETAIL =====
  pBackBtn: {
    background: '#efeadd', border: 'none', padding: '6px 12px',
    borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex',
    alignItems: 'center', gap: 6, color: '#1a1a1a', fontFamily: 'inherit'
  },
  pAthDetailName: {
    fontFamily: '"Fraunces", Georgia, serif', fontSize: 24,
    fontWeight: 500, letterSpacing: '-0.01em'
  },
  pTabBar: {
    display: 'flex',
    gap: 4,
    borderBottom: '1px solid #e0d9c8',
    marginBottom: 18,
    overflowX: 'auto',
    overflowY: 'hidden',
    flexWrap: 'nowrap',
    // Hide scrollbar across browsers
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    // Use scroll-snap so each tab snaps cleanly
    scrollSnapType: 'x mandatory',
    WebkitOverflowScrolling: 'touch'
  },
  pTab: {
    padding: '10px 14px',
    background: 'transparent', border: 'none',
    borderBottom: '2px solid transparent', cursor: 'pointer',
    fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, fontFamily: 'inherit',
    flexShrink: 0,
    whiteSpace: 'nowrap',
    scrollSnapAlign: 'start'
  },
  pTabActive: { color: '#1a1a1a', borderBottom: '2px solid #1a1a1a' },

  pDetailBody: { paddingBottom: 30 },
  pStatGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 18
  },
  detailStat: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '12px 14px',
    minWidth: 0
  },
  detailStatLabel: {
    fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#8a8275', fontWeight: 600, marginBottom: 6
  },
  detailStatVal: {
    fontFamily: '"Fraunces", Georgia, serif', fontSize: 22,
    fontWeight: 400, letterSpacing: '-0.02em', display: 'flex', alignItems: 'baseline'
  },
  detailStatUnit: { fontSize: 10, color: '#8a8275', marginLeft: 4, fontFamily: 'Inter, sans-serif', letterSpacing: '0.04em' },

  pFlagBox: {
    background: '#fdfbf5', border: '1px solid #f0cbb8',
    borderLeft: '3px solid #c8472b',
    borderRadius: 10, padding: '14px 16px', marginBottom: 18
  },
  pFlagBoxLabel: {
    fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: '#9c3a23', fontWeight: 600, marginBottom: 8
  },
  pFlagBoxItem: {
    display: 'flex', gap: 8, alignItems: 'flex-start',
    fontSize: 13, color: '#1a1a1a', padding: '4px 0', lineHeight: 1.45
  },

  pChartCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '16px 18px', marginBottom: 14
  },
  pChartHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    marginBottom: 10
  },
  pChartLabel: {
    fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: '#5a564d', fontWeight: 600
  },
  pChartSub: { fontSize: 11, color: '#8a8275', fontStyle: 'italic' },

  pSessionRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 0', borderBottom: '1px solid #e8e4dc'
  },
  pSessionTitle: { fontSize: 14, fontWeight: 500 },
  pSessionMeta: { fontSize: 11, color: '#8a8275', marginTop: 2, letterSpacing: '0.02em' },
  pSessionLoad: { fontFamily: '"Fraunces", Georgia, serif', fontSize: 18 },

  pNoteCard: {
    background: '#fdfbf5', border: '1px solid #e8e4dc',
    borderRadius: 10, padding: '14px 16px', marginBottom: 12
  },
  pNoteHead: {
    display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 8,
    flexWrap: 'wrap'
  },
  pNoteType: {
    fontSize: 10, padding: '2px 8px', borderRadius: 4,
    background: '#1a1a1a', color: '#f5f1e8', letterSpacing: '0.04em',
    textTransform: 'uppercase', fontWeight: 600
  },
  pNoteAuthor: { fontSize: 12, color: '#1a1a1a', fontWeight: 500 },
  pNoteDate: { fontSize: 11, color: '#8a8275', marginLeft: 'auto' },
  pNoteText: { fontSize: 14, lineHeight: 1.5, margin: '4px 0 8px', color: '#1a1a1a' },
  pNoteVis: { fontSize: 10, color: '#8a8275', letterSpacing: '0.06em', textTransform: 'uppercase' }
};
