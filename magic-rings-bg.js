/* magic-rings-bg.js
   Vanilla JS port of the MagicRings React Bits component.
   Mounts into #splashRingsBg as an ambient background for the splash screen.
   Params locked to the "Deep" preset — edit the CONFIG object below to change them.
   Requires three.js (r128) loaded beforehand — see index.html <script> order.
*/

(function () {
  const CONFIG = {
    color: '#4f5bd5',
    colorTwo: '#22d3ee',
    ringCount: 15,
    speed: 2,
    attenuation: 20,
    lineThickness: 2,
    baseRadius: 0.35,
    radiusStep: 0.1,
    scaleRate: 0.1,
    opacity: 1,
    blur: 0,
    noiseAmount: 0.1,
    rotation: 0,
    ringGap: 1,
    fadeIn: 0.7,
    fadeOut: 0.5,
    followMouse: false,   // ambient background, no mouse interaction by default
    mouseInfluence: 0.2,
    hoverScale: 1.2,
    parallax: 0.05,
    clickBurst: false,
  };

  const vertexShader = `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    precision highp float;

    uniform float uTime, uAttenuation, uLineThickness;
    uniform float uBaseRadius, uRadiusStep, uScaleRate;
    uniform float uOpacity, uNoiseAmount, uRotation, uRingGap;
    uniform float uFadeIn, uFadeOut;
    uniform float uMouseInfluence, uHoverAmount, uHoverScale, uParallax, uBurst;
    uniform vec2 uResolution, uMouse;
    uniform vec3 uColor, uColorTwo;
    uniform int uRingCount;

    const float HP = 1.5707963;
    const float CYCLE = 3.45;

    float fade(float t) {
      return t < uFadeIn ? smoothstep(0.0, uFadeIn, t) : 1.0 - smoothstep(uFadeOut, CYCLE - 0.2, t);
    }

    float ring(vec2 p, float ri, float cut, float t0, float px) {
      float t = mod(uTime + t0, CYCLE);
      float r = ri + t / CYCLE * uScaleRate;
      float d = abs(length(p) - r);
      float a = atan(abs(p.y), abs(p.x)) / HP;
      float th = max(1.0 - a, 0.5) * px * uLineThickness;
      float h = (1.0 - smoothstep(th, th * 1.5, d)) + 1.0;
      d += pow(cut * a, 3.0) * r;
      return h * exp(-uAttenuation * d) * fade(t);
    }

    void main() {
      float px = 1.0 / min(uResolution.x, uResolution.y);
      vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) * px;
      float cr = cos(uRotation), sr = sin(uRotation);
      p = mat2(cr, -sr, sr, cr) * p;
      p -= uMouse * uMouseInfluence;
      float sc = mix(1.0, uHoverScale, uHoverAmount) + uBurst * 0.3;
      p /= sc;
      vec3 c = vec3(0.0);
      float rcf = max(float(uRingCount) - 1.0, 1.0);
      for (int i = 0; i < 10; i++) {
        if (i >= uRingCount) break;
        float fi = float(i);
        vec2 pr = p - fi * uParallax * uMouse;
        vec3 rc = mix(uColor, uColorTwo, fi / rcf);
        c = mix(c, rc, vec3(ring(pr, uBaseRadius + fi * uRadiusStep, pow(uRingGap, fi), i == 0 ? 0.0 : 2.95 * fi, px)));
      }
      c *= 1.0 + uBurst * 2.0;
      float n = fract(sin(dot(gl_FragCoord.xy + uTime * 100.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * uNoiseAmount;
      gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)) * uOpacity);
    }
  `;

  function mountMagicRings(mount, opts) {
    if (!mount || typeof THREE === 'undefined') return null;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true });
    } catch (e) {
      return null;
    }

    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    if (opts.blur > 0) {
      mount.style.filter = 'blur(' + opts.blur + 'px)';
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10);
    camera.position.z = 1;

    const uniforms = {
      uTime: { value: 0 },
      uAttenuation: { value: opts.attenuation },
      uResolution: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Color(opts.color) },
      uColorTwo: { value: new THREE.Color(opts.colorTwo) },
      uLineThickness: { value: opts.lineThickness },
      uBaseRadius: { value: opts.baseRadius },
      uRadiusStep: { value: opts.radiusStep },
      uScaleRate: { value: opts.scaleRate },
      uRingCount: { value: opts.ringCount },
      uOpacity: { value: opts.opacity },
      uNoiseAmount: { value: opts.noiseAmount },
      uRotation: { value: (opts.rotation * Math.PI) / 180 },
      uRingGap: { value: opts.ringGap },
      uFadeIn: { value: opts.fadeIn },
      uFadeOut: { value: opts.fadeOut },
      uMouse: { value: new THREE.Vector2() },
      uMouseInfluence: { value: opts.followMouse ? opts.mouseInfluence : 0 },
      uHoverAmount: { value: 0 },
      uHoverScale: { value: opts.hoverScale },
      uParallax: { value: opts.parallax },
      uBurst: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    scene.add(quad);

    const mouse = [0, 0];
    const smoothMouse = [0, 0];
    let hoverAmount = 0;
    let isHovered = false;
    let burst = 0;

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setSize(w, h);
      renderer.setPixelRatio(dpr);
      uniforms.uResolution.value.set(w * dpr, h * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let onMouseMove, onMouseEnter, onMouseLeave, onClick;
    if (opts.followMouse || opts.clickBurst) {
      onMouseMove = (e) => {
        const rect = mount.getBoundingClientRect();
        mouse[0] = (e.clientX - rect.left) / rect.width - 0.5;
        mouse[1] = -((e.clientY - rect.top) / rect.height - 0.5);
      };
      onMouseEnter = () => { isHovered = true; };
      onMouseLeave = () => {
        isHovered = false;
        mouse[0] = 0;
        mouse[1] = 0;
      };
      onClick = () => { burst = 1; };
      mount.addEventListener('mousemove', onMouseMove);
      mount.addEventListener('mouseenter', onMouseEnter);
      mount.addEventListener('mouseleave', onMouseLeave);
      mount.addEventListener('click', onClick);
    }

    let frameId;
    const animate = (t) => {
      frameId = requestAnimationFrame(animate);

      smoothMouse[0] += (mouse[0] - smoothMouse[0]) * 0.08;
      smoothMouse[1] += (mouse[1] - smoothMouse[1]) * 0.08;
      hoverAmount += ((isHovered ? 1 : 0) - hoverAmount) * 0.08;
      burst *= 0.95;
      if (burst < 0.001) burst = 0;

      uniforms.uTime.value = t * 0.001 * opts.speed;
      uniforms.uMouse.value.set(smoothMouse[0], smoothMouse[1]);
      uniforms.uHoverAmount.value = hoverAmount;
      uniforms.uBurst.value = opts.clickBurst ? burst : 0;

      renderer.render(scene, camera);
    };
    frameId = requestAnimationFrame(animate);

    return function destroy() {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
      ro.disconnect();
      if (onMouseMove) {
        mount.removeEventListener('mousemove', onMouseMove);
        mount.removeEventListener('mouseenter', onMouseEnter);
        mount.removeEventListener('mouseleave', onMouseLeave);
        mount.removeEventListener('click', onClick);
      }
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      renderer.dispose();
      material.dispose();
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    const mount = document.getElementById('splashRingsBg');
    mountMagicRings(mount, CONFIG);
  });
})();
