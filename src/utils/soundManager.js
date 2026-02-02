import * as THREE from 'three';

class SoundManager {
	constructor() {
		this.listener = new THREE.AudioListener();
		this.sounds = new Map();
		this.loader = new THREE.AudioLoader();
	}

	init(camera) {
		camera.add(this.listener);
	}

	async loadSound(name, url, loop = false, volume = 0.5) {
		return new Promise((resolve, reject) => {
			this.loader.load(url, (buffer) => {
				const sound = new THREE.Audio(this.listener);
				sound.setBuffer(buffer);
				sound.setLoop(loop);
				sound.setVolume(volume);
				sound._baseVolume = volume;
				this.sounds.set(name, sound);
				resolve(sound);
			}, undefined, reject);
		});
	}

	play(name, fadeInDuration = 0) {
		const sound = this.sounds.get(name);
		if (!sound) return;

		const context = sound.context;
		if (context.state === 'suspended') {
			context.resume();
		}

		const targetVolume = sound._baseVolume !== undefined ? sound._baseVolume : 0.5;

		if (!sound.getLoop()) {
			const oneShot = new THREE.Audio(this.listener);
			oneShot.setBuffer(sound.buffer);
			oneShot.setVolume(targetVolume);
			oneShot.play();

			if (!sound._voices) sound._voices = new Set();
			sound._voices.add(oneShot);
			return;
		}

		if (!sound.isPlaying) {
			if (fadeInDuration > 0) {
				sound.setVolume(0);
				sound.play();
				sound.gain.gain.cancelScheduledValues(context.currentTime);
				sound.gain.gain.setValueAtTime(0, context.currentTime);
				sound.gain.gain.linearRampToValueAtTime(targetVolume, context.currentTime + fadeInDuration);
			} else {
				sound.setVolume(targetVolume);
				sound.play();
			}
		} else if (fadeInDuration > 0) {
			sound.gain.gain.cancelScheduledValues(context.currentTime);
			sound.gain.gain.linearRampToValueAtTime(targetVolume, context.currentTime + fadeInDuration);
		}
	}

	stop(name, fadeOutDuration = 0) {
		const sound = this.sounds.get(name);
		if (!sound) return;

		if (sound.isPlaying) {
			const context = sound.context;

			if (fadeOutDuration > 0) {
				sound.gain.gain.cancelScheduledValues(context.currentTime);
				sound.gain.gain.setValueAtTime(sound.getVolume(), context.currentTime);
				sound.gain.gain.linearRampToValueAtTime(0, context.currentTime + fadeOutDuration);

				setTimeout(() => {
					if (sound.isPlaying && sound.gain.gain.value <= 0.01) {
						sound.stop();
						sound.setVolume(sound._baseVolume || 0.5);
					}
				}, fadeOutDuration * 1000 + 50);
			} else {
				sound.stop();
			}
		}

		if (sound._voices) {
			sound._voices.forEach(v => {
				if (v.isPlaying) v.stop();
			});
			sound._voices.clear();
		}
	}

	setVolume(name, volume) {
		const sound = this.sounds.get(name);
		if (sound) {
			const context = sound.context;
			sound.gain.gain.setValueAtTime(volume, context.currentTime);
		}
	}

	isPlaying(name) {
		const sound = this.sounds.get(name);
		return sound ? sound.isPlaying : false;
	}
}

export const soundManager = new SoundManager();
