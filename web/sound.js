// 麦麦奇幻乐园 · 音效模块
// 全部音效由 Web Audio API 实时合成，**不引入任何 mp3/wav 资源文件**，
// 保证「零第三方依赖 + 仓库体积不变」的开源友好性。
//
// 设计要点：
//   1. AudioContext 懒加载：首次播放（必然来自用户点击）时才创建，规避浏览器自动播放限制
//   2. 静音开关状态存 localStorage，玩家下次打开仍生效
//   3. 代码规范：零 try/catch，异常走 Promise 错误通道或静默降级

var SOUND_PREF_KEY = "mcd_sound_on";
var soundCtx = null;
var soundEnabled = true;

// ===== 音效库 =====
// 每个音效是若干音符的序列：
//   f    起始频率 Hz（必填）
//   to   结束频率 Hz，做滑音（可选）
//   d    持续时间 秒
//   v    音量 0~0.3（默认 0.16）
//   t    波形 square / triangle / sawtooth / sine
//   w    起始延迟 秒（用于排成旋律）
//   n    噪声脉冲（骰子滚动用），true 时忽略 f
var SOUND_LIB = {
  // 轻点：通用按钮反馈
  click: [{ f: 760, d: 0.06, v: 0.07, t: "square" }],
  // 选卡：上行二音，确认感
  select: [
    { f: 660, d: 0.08, v: 0.14, t: "triangle" },
    { f: 990, d: 0.14, v: 0.14, t: "triangle", w: 0.07 }
  ],
  // 取消选卡：下行二音
  deselect: [
    { f: 700, d: 0.07, v: 0.1, t: "triangle" },
    { f: 480, d: 0.1, v: 0.1, t: "triangle", w: 0.06 }
  ],
  // 掷骰：三次滚动噪声 + 落定闷响，模拟骰子在盘中翻滚
  roll: [
    { n: true, d: 0.06, v: 0.13, w: 0 },
    { n: true, d: 0.06, v: 0.13, w: 0.09 },
    { n: true, d: 0.07, v: 0.14, w: 0.18 },
    { f: 200, to: 110, d: 0.16, v: 0.2, t: "sine", w: 0.28 }
  ],
  // 抽卡：欢快三连音
  card: [
    { f: 523, d: 0.09, v: 0.14, t: "triangle" },
    { f: 659, d: 0.09, v: 0.14, t: "triangle", w: 0.06 },
    { f: 784, d: 0.18, v: 0.16, t: "triangle", w: 0.12 }
  ],
  // 增益事件：明亮上行
  good: [
    { f: 523, d: 0.09, v: 0.14, t: "square" },
    { f: 659, d: 0.09, v: 0.14, t: "square", w: 0.07 },
    { f: 784, d: 0.2, v: 0.17, t: "square", w: 0.14 }
  ],
  // 减益事件：低沉下行，带轻微失真
  bad: [
    { f: 392, d: 0.13, v: 0.1, t: "sawtooth" },
    { f: 294, to: 210, d: 0.22, v: 0.12, t: "sawtooth", w: 0.11 }
  ],
  // 普通事件：双音拨弦感
  event: [
    { f: 440, d: 0.08, v: 0.12, t: "triangle" },
    { f: 554, d: 0.14, v: 0.12, t: "triangle", w: 0.07 }
  ],
  // 答对：清亮双音
  quizRight: [
    { f: 784, d: 0.1, v: 0.14, t: "square" },
    { f: 1046, d: 0.24, v: 0.16, t: "square", w: 0.09 }
  ],
  // 答错：下行二度
  quizWrong: [
    { f: 330, d: 0.14, v: 0.1, t: "sawtooth" },
    { f: 247, to: 180, d: 0.26, v: 0.12, t: "sawtooth", w: 0.12 }
  ],
  // 商店消费：金币感双音
  buy: [
    { f: 988, d: 0.07, v: 0.1, t: "square" },
    { f: 1319, d: 0.18, v: 0.11, t: "square", w: 0.06 }
  ],
  // 开局：号角式上行
  start: [
    { f: 392, d: 0.12, v: 0.14, t: "square" },
    { f: 523, d: 0.12, v: 0.14, t: "square", w: 0.1 },
    { f: 659, d: 0.12, v: 0.14, t: "square", w: 0.2 },
    { f: 784, d: 0.34, v: 0.17, t: "square", w: 0.3 }
  ],
  // 胜利：小号旋律 Do Mi Sol Do
  victory: [
    { f: 523, d: 0.14, v: 0.15, t: "square" },
    { f: 659, d: 0.14, v: 0.15, t: "square", w: 0.15 },
    { f: 784, d: 0.16, v: 0.16, t: "square", w: 0.3 },
    { f: 1046, d: 0.55, v: 0.18, t: "square", w: 0.47 }
  ],
  // 领奖：华彩上行
  reward: [
    { f: 784, d: 0.1, v: 0.13, t: "triangle" },
    { f: 1046, d: 0.1, v: 0.13, t: "triangle", w: 0.09 },
    { f: 1319, d: 0.45, v: 0.16, t: "triangle", w: 0.18 }
  ]
};

// ===== 底层：创建 / 恢复 AudioContext =====
function soundEnsureCtx() {
  if (soundCtx) {
    return soundCtx;
  }
  var Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    // 极老浏览器不支持 Web Audio：静默降级，不影响游戏
    console.warn("[sound] 当前浏览器不支持 Web Audio API，音效已禁用");
    return null;
  }
  soundCtx = new Ctor();
  console.log("[sound] AudioContext 已创建");
  return soundCtx;
}

// 浏览器可能把上下文挂起（如切到后台），播放前先恢复
function soundResume() {
  var ctx = soundEnsureCtx();
  if (!ctx) {
    return null;
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

// ===== 底层：单个音符 =====
function soundTone(ctx, note, baseTime) {
  var t0 = baseTime + (note.w || 0);
  var dur = note.d || 0.1;
  var vol = note.v === undefined ? 0.16 : note.v;

  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = note.t || "sine";
  osc.frequency.setValueAtTime(note.f, t0);
  if (note.to) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, note.to), t0 + dur);
  }
  // 快速起音 + 指数衰减，听感干净不刺耳
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// ===== 底层：噪声脉冲（骰子滚动）=====
var noiseBuf = null;
function soundNoiseBuffer(ctx) {
  if (noiseBuf) {
    return noiseBuf;
  }
  var len = Math.floor(ctx.sampleRate * 0.5);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  var data = noiseBuf.getChannelData(0);
  for (var i = 0; i < len; i += 1) {
    // 简单伪随机（0~1 之间），乘出衰减包络让它像木珠敲击
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  }
  return noiseBuf;
}

function soundNoise(ctx, note, baseTime) {
  var t0 = baseTime + (note.w || 0);
  var dur = note.d || 0.06;
  var vol = note.v === undefined ? 0.12 : note.v;

  var src = ctx.createBufferSource();
  src.buffer = soundNoiseBuffer(ctx);
  var filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1400;
  filter.Q.value = 1.1;
  var gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ===== 对外接口 =====
// 播放音效；name 不在音效库或已静音时静默返回
function soundPlay(name) {
  if (!soundEnabled) {
    return;
  }
  var notes = SOUND_LIB[name];
  if (!notes) {
    console.warn("[sound] 未定义的音效:", name);
    return;
  }
  var ctx = soundResume();
  if (!ctx) {
    return;
  }
  var base = ctx.currentTime + 0.02;
  for (var i = 0; i < notes.length; i += 1) {
    if (notes[i].n) {
      soundNoise(ctx, notes[i], base);
    } else {
      soundTone(ctx, notes[i], base);
    }
  }
}

// 读取本地静音偏好（隐私模式下 localStorage 可能不可用，走 Promise 错误通道降级）
function soundLoadPref() {
  Promise.resolve().then(function () {
    return window.localStorage.getItem(SOUND_PREF_KEY);
  }).then(function (val) {
    if (val !== null && val !== undefined) {
      soundEnabled = val !== "0";
    }
  }, function (err) {
    console.warn("[sound] 读取音效偏好失败，使用默认开启:", err && err.message);
  });
  return soundEnabled;
}

// 持久化偏好
function soundSavePref() {
  Promise.resolve().then(function () {
    window.localStorage.setItem(SOUND_PREF_KEY, soundEnabled ? "1" : "0");
  }, function (err) {
    console.warn("[sound] 保存音效偏好失败:", err && err.message);
  });
}

function soundIsOn() {
  return soundEnabled;
}

// 切换开关，返回切换后的状态
function soundToggle() {
  soundEnabled = !soundEnabled;
  soundSavePref();
  if (soundEnabled) {
    // 开启时给一声轻响作为确认
    soundPlay("click");
  }
  return soundEnabled;
}

// 刷新页面上的所有音效开关文案与图标
function soundSyncButtons() {
  var btns = document.querySelectorAll(".btn-sound");
  for (var i = 0; i < btns.length; i += 1) {
    btns[i].textContent = soundEnabled ? "🔊" : "🔇";
    btns[i].setAttribute("title", soundEnabled ? "点击关闭音效" : "点击开启音效");
    btns[i].setAttribute("aria-label", soundEnabled ? "关闭音效" : "开启音效");
  }
  var row = document.getElementById("sound-row-tip");
  if (row) {
    row.textContent = soundEnabled ? "音效已开启" : "音效已关闭";
  }
}

// 首次用户交互时唤醒音频上下文（部分浏览器需要真实手势才能出声）
function soundBindGesture() {
  var wake = function () {
    soundResume();
  };
  document.addEventListener("pointerdown", wake, { once: true });
  document.addEventListener("touchstart", wake, { once: true });
}