import * as THREE from 'three';

export class JetFlame {
    constructor() {
        this.group = new THREE.Group();

        const vertexShader = `
            varying vec2 vUv;
            varying vec3 vPosition;
            void main() {
                vUv = uv;
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            uniform float time;
            uniform float throttle;
            uniform float isBoosting;
            varying vec2 vUv;
            varying vec3 vPosition;

            float noise(vec2 p) {
                return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
            }

            void main() {
                float v = 1.0 - vUv.y;
                
                float activeLen = isBoosting > 0.5 ? 1.3 : (0.3 + throttle * 0.7);
                float intensity = isBoosting > 0.5 ? 2.0 : (0.6 + throttle * 0.9);

                if (v > activeLen) discard;

                vec3 coreColor = vec3(1.0, 1.0, 0.95); 
                vec3 midColor = vec3(1.0, 0.4, 0.1);  
                vec3 outerColor = vec3(0.15, 0.35, 1.0); 
                
                if (isBoosting > 0.5) {
                    midColor = vec3(1.0, 0.5, 0.2); 
                    outerColor = vec3(0.3, 0.3, 1.0);
                }

                float radial = length(vPosition.xy);
                float glow = exp(-radial * 10.0);
                float core = exp(-radial * 28.0);
                
                float shockFreq = 20.0;
                float shock = pow(max(0.0, sin(v * shockFreq - time * 50.0)), 5.0);
                shock *= (0.2 + throttle * 0.8 + isBoosting * 0.4);
                
                float diamondPos = sin(v * 26.0 - time * 40.0);
                float diamondMesh = pow(max(0.0, diamondPos), 9.0) * (1.0 - v/activeLen);

                float flicker = 1.0 + 0.18 * noise(vec2(time * 20.0, v * 10.0));

                vec3 finalColor = mix(outerColor * 0.7, midColor, glow);
                finalColor = mix(finalColor, coreColor, core + diamondMesh * 0.7);
                
                finalColor += coreColor * shock * glow;

                float fade = pow(1.0 - v / activeLen, 1.4);
                float alpha = fade * intensity * (glow * 2.2 + core);
                alpha = clamp(alpha * flicker, 0.0, 1.0);

                gl_FragColor = vec4(finalColor * intensity, alpha);
            }
        `;

        this.uniforms = {
            time: { value: 0 },
            throttle: { value: 0 },
            isBoosting: { value: 0 }
        };

        const geometry = new THREE.CylinderGeometry(0.1, 0.2, 2, 16, 32, true);
        geometry.translate(0, -1, 0);
        geometry.rotateX(-Math.PI / 2);

        this.material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            vertexShader,
            fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        this.flame = new THREE.Mesh(geometry, this.material);
        this.group.add(this.flame);

        this.light = new THREE.PointLight(0xffaa44, 1, 5);
        this.light.position.set(0, 0, 0);
        this.group.add(this.light);
    }

    update(throttle, isBoosting, time, dt) {
        this.uniforms.throttle.value = throttle;
        this.uniforms.isBoosting.value = isBoosting ? 1.0 : 0.0;
        this.uniforms.time.value = time;

        const s = isBoosting ? 2.2 : (0.6 + throttle * 1.2);
        
        const widthScale = 1.1 + throttle * 0.4;
        this.flame.scale.set(widthScale, widthScale, s);
        
        this.light.intensity = isBoosting ? 7.5 : (1.0 + throttle * 2.5);
        this.light.color.setHex(isBoosting ? 0x9999ff : 0xff7722);
    }
}
