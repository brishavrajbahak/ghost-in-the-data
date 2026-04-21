import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { ChromaticAberration, EffectComposer, Noise, Select, Selection, SelectiveBloom } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { RefreshCcw, Tv } from "lucide-react";

const normalize = (value, min, max) => {
  if (!Number.isFinite(value)) return 0;
  const span = max - min;
  if (!Number.isFinite(span) || span === 0) return 0;
  return ((value - min) / span) * 2 - 1;
};

const buildRenderSet = (rows, anomalies, maxPoints) => {
  if (!Array.isArray(rows) || rows.length === 0) return { rows: [], rowIndexes: [] };
  if (rows.length <= maxPoints) return { rows, rowIndexes: rows.map((_, i) => i) };

  const anomalyIndexes = new Set((anomalies || []).map((a) => a.index).filter((i) => Number.isInteger(i)));
  const selected = [];
  const selectedIndexes = [];

  for (const idx of anomalyIndexes) {
    if (idx >= 0 && idx < rows.length) {
      selected.push(rows[idx]);
      selectedIndexes.push(idx);
    }
  }

  for (let i = 0; i < rows.length && selected.length < maxPoints; i++) {
    if (anomalyIndexes.has(i)) continue;
    selected.push(rows[i]);
    selectedIndexes.push(i);
  }

  return { rows: selected, rowIndexes: selectedIndexes };
};

const VERTEX_SHADER = `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;

  attribute vec3 color;
  attribute float aIntensity;

  varying vec3 vColor;
  varying float vIntensity;

  void main() {
    vColor = color;
    vIntensity = aIntensity;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    float pulse = 0.65 + 0.35 * sin(uTime * 1.25 + position.x * 1.7 + position.y * 1.2);
    float anomalyMix = smoothstep(0.35, 1.0, vIntensity);
    float size = uSize * (0.65 + vIntensity * 1.6) * mix(1.0, pulse, anomalyMix);
    size *= uPixelRatio;

    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;

  varying vec3 vColor;
  varying float vIntensity;

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv) * 2.0;

    float core = smoothstep(1.0, 0.0, d);
    float halo = pow(core, 2.2);
    float bloom = pow(core, 8.0);

    float alpha = (0.10 + 0.90 * vIntensity) * (0.55 * halo + 0.45 * bloom);

    vec3 c = vColor * (0.35 + 1.35 * vIntensity);
    c *= (0.65 * halo + 0.75 * bloom);

    gl_FragColor = vec4(c, alpha);
  }
`;

const PointCloud = ({ geometry, material, rowIndexByPoint, anomalyByRowIndex, onSelectAnomaly }) => {
  const pointsRef = useRef(null);

  useFrame(({ clock, gl }) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = clock.getElapsedTime() * 0.08;
    if (!material?.uniforms) return;
    material.uniforms.uTime.value = clock.getElapsedTime();
    material.uniforms.uPixelRatio.value = Math.min(2, gl.getPixelRatio());
  });

  const handleClick = (e) => {
    const pointIndex =
      typeof e.index === "number"
        ? e.index
        : typeof e?.intersections?.[0]?.index === "number"
          ? e.intersections[0].index
          : null;

    if (pointIndex == null) return;
    const rowIndex = rowIndexByPoint[pointIndex];
    if (!Number.isInteger(rowIndex)) return;
    const anomaly = anomalyByRowIndex.get(rowIndex);
    if (anomaly) onSelectAnomaly?.(anomaly);
  };

  return <points ref={pointsRef} geometry={geometry} material={material} onClick={handleClick} />;
};

const RotatingPoints = ({ geometry, material }) => {
  const pointsRef = useRef(null);

  useFrame(({ clock, gl }) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y = clock.getElapsedTime() * 0.08;
    if (!material?.uniforms) return;
    material.uniforms.uTime.value = clock.getElapsedTime();
    material.uniforms.uPixelRatio.value = Math.min(2, gl.getPixelRatio());
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
};

const SpectralCloud = ({ data, anomalies, columns, height = 440, maxPoints = 7000, onSelectAnomaly }) => {
  const xCol = columns?.x;
  const yCol = columns?.y;
  const zCol = columns?.z;

  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const initialCam = useMemo(() => new THREE.Vector3(2.35, 1.75, 2.65), []);
  const [vhsEnabled, setVhsEnabled] = useState(false);

  const { rows: renderRows, rowIndexes } = useMemo(
    () => buildRenderSet(Array.isArray(data) ? data : [], anomalies, maxPoints),
    [data, anomalies, maxPoints]
  );

  const anomalyByRowIndex = useMemo(() => {
    const map = new Map();
    for (const a of anomalies || []) {
      if (Number.isInteger(a.index)) map.set(a.index, a);
    }
    return map;
  }, [anomalies]);

  const bounds = useMemo(() => {
    const cols = [xCol, yCol, zCol].filter(Boolean);
    const result = {};
    for (const c of cols) {
      let min = Infinity;
      let max = -Infinity;
      for (const row of renderRows) {
        const v = row?.[c];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      if (min === Infinity || max === -Infinity) {
        min = 0;
        max = 1;
      }
      result[c] = { min, max };
    }
    return result;
  }, [renderRows, xCol, yCol, zCol]);

  const { normal, anomalous } = useMemo(() => {
    const normalPos = [];
    const normalCol = [];
    const normalIntensity = [];
    const normalRowIndex = [];

    const anomalyPos = [];
    const anomalyCol = [];
    const anomalyIntensity = [];
    const anomalyRowIndex = [];

    const base = new THREE.Color("#94a3b8");
    const anomaly = new THREE.Color("#00f0ff");
    const anomalyAlt = new THREE.Color("#8b5cf6");

    const xB = bounds[xCol] || { min: 0, max: 1 };
    const yB = bounds[yCol] || { min: 0, max: 1 };
    const zB = bounds[zCol] || { min: 0, max: 1 };

    for (let i = 0; i < renderRows.length; i++) {
      const row = renderRows[i] || {};
      const rowIndex = rowIndexes[i];

      const x = normalize(row[xCol], xB.min, xB.max) * 1.25;
      const y = normalize(row[yCol], yB.min, yB.max) * 1.1;
      const z = normalize(row[zCol], zB.min, zB.max) * 1.25;

      const a = anomalyByRowIndex.get(rowIndex);
      const sev = a ? Number(a.severity || 0) : 0;
      const isAnom = Boolean(a);
      const color = a ? (sev >= 0.75 ? anomaly : anomalyAlt) : base;
      const inten = a ? Math.min(1.0, 0.62 + sev * 0.72) : 0.10;

      const targetPos = isAnom ? anomalyPos : normalPos;
      const targetCol = isAnom ? anomalyCol : normalCol;
      const targetIntensity = isAnom ? anomalyIntensity : normalIntensity;
      const targetRowIndex = isAnom ? anomalyRowIndex : normalRowIndex;

      targetPos.push(x, y, z);
      targetCol.push(color.r, color.g, color.b);
      targetIntensity.push(inten);
      targetRowIndex.push(rowIndex);
    }

    const build = (pos, col, inten) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 3));
      geo.setAttribute("aIntensity", new THREE.BufferAttribute(new Float32Array(inten), 1));
      geo.computeBoundingSphere();
      return geo;
    };

    return {
      normal: { geometry: build(normalPos, normalCol, normalIntensity), rowIndexByPoint: normalRowIndex },
      anomalous: { geometry: build(anomalyPos, anomalyCol, anomalyIntensity), rowIndexByPoint: anomalyRowIndex },
    };
  }, [renderRows, rowIndexes, bounds, xCol, yCol, zCol, anomalyByRowIndex]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 18.0 },
        uPixelRatio: { value: 1.0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  useEffect(() => {
    return () => {
      material.dispose?.();
      normal.geometry.dispose?.();
      anomalous.geometry.dispose?.();
    };
  }, [material, normal.geometry, anomalous.geometry]);

  if (!xCol || !yCol || !zCol) return null;
  if (!renderRows.length) return null;

  return (
    <div className="glass-card card" style={{ padding: 14 }}>
      <div className="vizHeader">
        <div className="card__title" style={{ marginBottom: 0 }}>
          3D Spectral Cloud
        </div>
        <div className="row" style={{ gap: 10 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Click a glowing point to narrate
          </div>
          <button
            type="button"
            className="btn btn--subtle"
            onClick={() => setVhsEnabled((v) => !v)}
            style={{ height: 34, padding: "0 10px" }}
            title={vhsEnabled ? "Disable VHS noise" : "Enable VHS noise"}
          >
            <Tv size={16} />
            <span>{vhsEnabled ? "VHS On" : "VHS Off"}</span>
          </button>
          <button
            type="button"
            className="btn btn--subtle"
            onClick={() => {
              if (cameraRef.current) {
                cameraRef.current.position.copy(initialCam);
                cameraRef.current.lookAt(0, 0, 0);
              }
              controlsRef.current?.reset?.();
            }}
            style={{ height: 34, padding: "0 10px" }}
            title="Reset camera"
          >
            <RefreshCcw size={16} />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <div className="vizCanvas" style={{ height }}>
        <Canvas
          camera={{ position: [initialCam.x, initialCam.y, initialCam.z], fov: 58 }}
          onCreated={({ camera }) => {
            cameraRef.current = camera;
          }}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.9} />
          <pointLight position={[3, 3, 3]} intensity={0.7} />
          <axesHelper args={[1.6]} />
          <Selection>
            <EffectComposer multisampling={0}>
              <SelectiveBloom
                intensity={1.55}
                luminanceThreshold={0.35}
                luminanceSmoothing={0.25}
                radius={0.75}
              />
              <ChromaticAberration offset={[0.00075, 0.00075]} blendFunction={BlendFunction.NORMAL} />
              {vhsEnabled ? <Noise opacity={0.045} blendFunction={BlendFunction.SOFT_LIGHT} /> : null}
            </EffectComposer>

            <RotatingPoints geometry={normal.geometry} material={material} />

            <Select enabled>
              <PointCloud
                geometry={anomalous.geometry}
                material={material}
                rowIndexByPoint={anomalous.rowIndexByPoint}
                anomalyByRowIndex={anomalyByRowIndex}
                onSelectAnomaly={onSelectAnomaly}
              />
            </Select>
          </Selection>
          <OrbitControls ref={controlsRef} enablePan enableRotate enableZoom />
        </Canvas>
      </div>

      <div className="muted" style={{ marginTop: 10, fontSize: 11, textAlign: "center" }}>
        <span
          style={{
            display: "inline-flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: "#ef4444", display: "inline-block" }} />
            <span style={{ fontWeight: 900 }}>X:</span> <span style={{ fontFamily: "var(--font-mono)" }}>{xCol}</span>
          </span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: "#22c55e", display: "inline-block" }} />
            <span style={{ fontWeight: 900 }}>Y:</span> <span style={{ fontFamily: "var(--font-mono)" }}>{yCol}</span>
          </span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 99, background: "#3b82f6", display: "inline-block" }} />
            <span style={{ fontWeight: 900 }}>Z:</span> <span style={{ fontFamily: "var(--font-mono)" }}>{zCol}</span>
          </span>
        </span>
      </div>
    </div>
  );
};

export default SpectralCloud;
