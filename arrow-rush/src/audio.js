export class ReactionAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.timer = null;
    this.step = 0;
    this.running = false;
    this.fever = false;
    this.gogo = false;
    this.special = false;
    this.bgmVolume = 0.55;
    this.sfxVolume = 0.80;
  }

  async ensureStarted() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.master.gain.value = 0.75;
      this.bgmGain.gain.value = this.bgmVolume;
      this.sfxGain.gain.value = this.sfxVolume;
      this.bgmGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return true;
  }

  setVolumes({ bgm, sfx }) {
    this.bgmVolume = Math.max(0, Math.min(1, Number(bgm) || 0));
    this.sfxVolume = Math.max(0, Math.min(1, Number(sfx) || 0));
    if (this.bgmGain) this.bgmGain.gain.setTargetAtTime(this.bgmVolume, this.ctx.currentTime, 0.03);
    if (this.sfxGain) this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.03);
  }

  tone(freq, duration = 0.08, volume = 0.16, type = 'sine', destination = this.sfxGain, delay = 0) {
    if (!this.ctx || !destination || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  sweep(startFreq, endFreq, duration = 0.20, volume = 0.15, type = 'triangle') {
    if (!this.ctx || !this.sfxGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  playPerfect() { this.tone(880, .085, .17, 'triangle'); this.tone(1320, .07, .11, 'sine', this.sfxGain, .028); }
  playGood() { this.tone(620, .09, .13, 'triangle'); }
  playMiss(protectedMiss = false) {
    if (protectedMiss) { this.tone(420, .11, .16, 'square'); this.tone(690, .09, .10, 'triangle', this.sfxGain, .055); return; }
    this.tone(145, .16, .18, 'sawtooth');
  }
  playMilestone() { [523, 659, 784].forEach((f, i) => this.tone(f, .12, .13, 'triangle', this.sfxGain, i * .065)); }
  playSpecialCharge(progress = 0) {
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    const start = 260 + p * 260;
    const end = 720 + p * 900;
    this.sweep(start, end, .22, .14 + p * .04, 'triangle');
    this.tone(end * .75, .06, .07, 'sine', this.sfxGain, .14);
  }
  playCycleReady() { this.tone(740, .055, .09, 'square'); this.tone(980, .055, .07, 'triangle', this.sfxGain, .045); }
  playItemGain() {
    this.sweep(380, 1550, .32, .22, 'triangle');
    [784, 1047, 1568].forEach((f, i) => this.tone(f, .11, .12, 'sine', this.sfxGain, .08 + i * .07));
  }
  playModeStart(kind) {
    if (kind === 'special') {
      this.sweep(300, 1600, .40, .21, 'triangle');
      [659, 988, 1319].forEach((f, i) => this.tone(f, .11, .11, 'sine', this.sfxGain, i * .07));
      return;
    }
    this.sweep(220, 1300, .34, .19, 'square');
    this.tone(1568, .12, .11, 'triangle', this.sfxGain, .18);
  }

  setFever(enabled) {
    const next = Boolean(enabled);
    if (next === this.fever) return;
    this.fever = next;
    if (this.running) this.restartBgmTimer();
  }

  setRushMode(gogo, special) {
    const nextGogo = Boolean(gogo);
    const nextSpecial = Boolean(special);
    if (nextGogo === this.gogo && nextSpecial === this.special) return;
    this.gogo = nextGogo;
    this.special = nextSpecial;
    if (this.running) this.restartBgmTimer();
  }

  startBgm() { this.running = true; this.restartBgmTimer(); }
  pauseBgm() { this.running = false; if (this.timer) clearInterval(this.timer); this.timer = null; }
  stopBgm() { this.pauseBgm(); this.step = 0; this.fever = false; this.gogo = false; this.special = false; }

  restartBgmTimer() {
    if (this.timer) clearInterval(this.timer);
    if (!this.running || !this.ctx) return;
    let interval = 270;
    let notes = [165, 220, 196, 247];
    let volume = .035;
    if (this.gogo && this.special) {
      interval = 112; notes = [220, 330, 523, 392, 659, 523]; volume = .049;
    } else if (this.gogo) {
      interval = 150; notes = [196, 294, 392, 330, 440, 392]; volume = .046;
    } else if (this.special) {
      interval = 138; notes = [262, 330, 523, 392, 659, 523]; volume = .045;
    } else if (this.fever) {
      interval = 180; notes = [220, 277, 330, 440, 330, 277]; volume = .055;
    }
    const tick = () => {
      const f = notes[this.step % notes.length];
      this.tone(f, Math.min(.12, interval / 1000 * .72), volume, 'square', this.bgmGain);
      this.step += 1;
    };
    tick();
    this.timer = setInterval(tick, interval);
  }
}
