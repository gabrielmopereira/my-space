"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type DitherWaveProps = {
  children?: React.ReactNode;
  className?: string;
  downScale?: number;
  height?: number | string;
  intensity?: number;
  maxFPS?: number;
  opacity?: number;
  pauseWhenOffscreen?: boolean;
  primaryColor?: string;
  quality?: "low" | "medium" | "high";
  scale?: number;
  secondaryColor?: string;
  speed?: number;
  tertiaryColor?: string;
  width?: number | string;
};

const VERTEX_SHADER = `
  attribute vec3 position;
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;

  #define COLOR_COUNT 3

  uniform float iTime;
  uniform vec2 iResolution;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform float uScale;
  uniform float uDownScale;
  uniform float uOpacity;

  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;

  vec3 colors[COLOR_COUNT];

  void setupColorPalette() {
    colors[0] = uColor1;
    colors[1] = uColor2;
    colors[2] = uColor3;
  }

  float Bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x / 2.0 + a.y * a.y * 0.75);
  }

  #define Bayer4(a)   (Bayer2(0.5 * (a)) * 0.25 + Bayer2(a))
  #define Bayer8(a)   (Bayer4(0.5 * (a)) * 0.25 + Bayer2(a))
  #define Bayer16(a)  (Bayer8(0.5 * (a)) * 0.25 + Bayer2(a))
  #define Bayer32(a)  (Bayer16(0.5 * (a)) * 0.25 + Bayer2(a))
  #define Bayer64(a)  (Bayer32(0.5 * (a)) * 0.25 + Bayer2(a))

  vec3 applyDitheredColor(float value, vec2 pixelCoord) {
    float paletteIndex = clamp(value, 0.0, 1.0) * float(COLOR_COUNT - 1);

    vec3 colorA = vec3(0.0);
    vec3 colorB = vec3(0.0);

    for (int i = 0; i < COLOR_COUNT; i++) {
      if (float(i) == floor(paletteIndex)) {
        colorA = colors[i];
        if (i < COLOR_COUNT - 1) {
          colorB = colors[i + 1];
        } else {
          colorB = colorA;
        }
        break;
      }
    }

    float ditherValue = Bayer64(pixelCoord * 0.25);

    float blendAmount = float(fract(paletteIndex) > ditherValue);

    return mix(colorA, colorB, blendAmount);
  }

  float flowField(vec2 p, float t) {
    return sin(p.x + sin(p.y + t * 0.1)) * sin(p.y * p.x * 0.1 + t * 0.2);
  }

  vec2 computeField(vec2 p, float t) {
    vec2 ep = vec2(0.05, 0.0);
    vec2 result = vec2(0.0);

    for (int i = 0; i < 20; i++) {
      float t0 = flowField(p, t);
      float t1 = flowField(p + ep.xy, t);
      float t2 = flowField(p + ep.yx, t);
      vec2 gradient = vec2((t1 - t0), (t2 - t0)) / ep.xx;
      vec2 tangent = vec2(-gradient.y, gradient.x);

      p += tangent * 0.5 + gradient * 0.005;
      p.x += sin(t * 0.25) * 0.1;
      p.y += cos(t * 0.25) * 0.1;
      result = gradient;
    }

    return result;
  }

  void main() {
    setupColorPalette();

    vec2 uv = gl_FragCoord.xy / iResolution.xy - 0.5;
    uv.x *= iResolution.x / iResolution.y;
    float animTime = iTime * uSpeed;

    vec2 p = uv * uScale;

    vec2 field = computeField(p, animTime);

    float colorValue = length(field) * uIntensity;
    colorValue = clamp(colorValue, 0.0, 1.0);

    vec3 finalColor = applyDitheredColor(colorValue, gl_FragCoord.xy / uDownScale);

    gl_FragColor = vec4(finalColor, uOpacity);
  }
`;

const QUAD_VERTICES = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);

const QUALITY_SETTINGS = {
  high: { antialias: true, pixelRatioCap: 3 },
  low: { antialias: false, pixelRatioCap: 1 },
  medium: { antialias: true, pixelRatioCap: 2 },
} as const;

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/v.exec(hex);
  return result
    ? {
        b: Number.parseInt(result[3], 16) / 255,
        g: Number.parseInt(result[2], 16) / 255,
        r: Number.parseInt(result[1], 16) / 255,
      }
    : { b: 0, g: 0, r: 0 };
};

const DitherWave: React.FC<DitherWaveProps> = ({
  children,
  className,
  downScale = 0.5,
  height = "100%",
  intensity = 1.0,
  maxFPS = 60,
  opacity = 1.0,
  pauseWhenOffscreen = true,
  primaryColor = "#5227FF",
  quality = "medium",
  scale = 6.0,
  secondaryColor = "#5227FF",
  speed = 1.0,
  tertiaryColor = "#0a0a0a",
  width = "100%",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const isVisibleRef = useRef<boolean>(true);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const container = containerRef.current;
    const color1 = hexToRgb(primaryColor);
    const color2 = hexToRgb(secondaryColor);
    const color3 = hexToRgb(tertiaryColor);

    const settings = QUALITY_SETTINGS[quality];
    const pixelRatio = Math.min(window.devicePixelRatio, settings.pixelRatioCap);

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: settings.antialias,
      depth: false,
      powerPreference: "high-performance",
      premultipliedAlpha: false,
      stencil: false,
    });

    if (!gl) {
      return;
    }

    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) {
        throw new Error("DitherWave: gl.createShader returned null");
      }
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`DitherWave: shader compile failed — ${info}`);
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error("DitherWave: gl.createProgram returned null");
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error(`DitherWave: program link failed — ${info}`);
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, "iTime");
    const uResolution = gl.getUniformLocation(program, "iResolution");
    const uSpeed = gl.getUniformLocation(program, "uSpeed");
    const uIntensity = gl.getUniformLocation(program, "uIntensity");
    const uScale = gl.getUniformLocation(program, "uScale");
    const uDownScale = gl.getUniformLocation(program, "uDownScale");
    const uOpacity = gl.getUniformLocation(program, "uOpacity");
    const uColor1 = gl.getUniformLocation(program, "uColor1");
    const uColor2 = gl.getUniformLocation(program, "uColor2");
    const uColor3 = gl.getUniformLocation(program, "uColor3");

    container.append(canvas);

    gl.useProgram(program);
    gl.uniform3f(uColor1, color1.r, color1.g, color1.b);
    gl.uniform3f(uColor2, color2.r, color2.g, color2.b);
    gl.uniform3f(uColor3, color3.r, color3.g, color3.b);
    gl.uniform1f(uSpeed, speed);
    gl.uniform1f(uIntensity, intensity);
    gl.uniform1f(uScale, scale);
    gl.uniform1f(uDownScale, downScale);
    gl.uniform1f(uOpacity, opacity);
    gl.clearColor(0, 0, 0, 0);

    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const bufferWidth = Math.max(1, Math.round(rect.width * pixelRatio));
      const bufferHeight = Math.max(1, Math.round(rect.height * pixelRatio));
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
      gl.viewport(0, 0, bufferWidth, bufferHeight);
      gl.useProgram(program);
      gl.uniform2f(uResolution, bufferWidth, bufferHeight);
    };

    const draw = (timeSeconds: number) => {
      gl.useProgram(program);
      gl.uniform1f(uTime, timeSeconds);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    applySize();
    draw(0);

    let observer: IntersectionObserver | null = null;
    if (pauseWhenOffscreen) {
      observer = new IntersectionObserver(
        (entries) => {
          isVisibleRef.current = entries[0].isIntersecting;
        },
        { threshold: 0 },
      );
      observer.observe(container);
    }

    const frameInterval = 1000 / maxFPS;

    const animate = (currentTime: number) => {
      rafRef.current = requestAnimationFrame(animate);

      if (!startTimeRef.current) {
        startTimeRef.current = currentTime;
        lastFrameTimeRef.current = currentTime;
      }

      const elapsed = currentTime - lastFrameTimeRef.current;

      if (elapsed < frameInterval) {
        return;
      }

      lastFrameTimeRef.current = currentTime - (elapsed % frameInterval);

      if (pauseWhenOffscreen && !isVisibleRef.current) {
        return;
      }

      draw((currentTime - startTimeRef.current) * 0.001);
    };

    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const startLoop = () => {
      if (rafRef.current) {
        return;
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    const stopLoop = () => {
      if (!rafRef.current) {
        return;
      }
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      startTimeRef.current = 0;
    };

    if (!reducedMotionQuery.matches) {
      startLoop();
    }

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        stopLoop();
        return;
      }
      startLoop();
    };

    reducedMotionQuery.addEventListener("change", handleReducedMotionChange);

    const handleResize = () => {
      applySize();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      reducedMotionQuery.removeEventListener("change", handleReducedMotionChange);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      observer?.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      if (container.contains(canvas)) {
        canvas.remove();
      }
    };
  }, [
    speed,
    intensity,
    scale,
    downScale,
    primaryColor,
    secondaryColor,
    tertiaryColor,
    opacity,
    quality,
    maxFPS,
    pauseWhenOffscreen,
  ]);

  const widthStyle = typeof width === "number" ? `${width}px` : width;
  const heightStyle = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      ref={containerRef}
      style={{ height: heightStyle, width: widthStyle }}
    >
      {children && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
};

export default DitherWave;
