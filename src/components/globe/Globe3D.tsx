import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { gstime, jday, sunPos } from 'satellite.js'
import { orbitPathEci } from '@/lib/orbit/propagate'
import { EARTH_RADIUS_KM, geodeticToVec3, graticuleSegments, loadLandOutlines, ringsToSegments } from '@/lib/util/geo'
import type { GroundStation, SatelliteState, SpaceObject } from '@/lib/types'

/**
 * Earth-centred inertial globe.
 *
 * Frame conventions, since they drive everything else here:
 *   • The scene works in ECI with +Z through the north pole, scaled so one
 *     unit is one Earth radius. Satellites come straight from SGP4 in that
 *     frame, so their positions need no correction.
 *   • The Earth mesh, coastlines and ground stations live in an Earth-fixed
 *     group that is rotated by GMST each frame. That is what makes the planet
 *     turn under the orbits instead of dragging them along with it.
 *
 * The globe is drawn procedurally — no texture downloads — so it renders
 * identically offline. Coastlines come from the bundled Natural Earth outline.
 */

interface Globe3DProps {
  objects: SpaceObject[]
  states: Record<number, SatelliteState>
  stations: GroundStation[]
  selectedId: number | null
  /**
   * The selected object, supplied separately because `objects` is usually a
   * filtered view — the orbit of a selection should not vanish just because a
   * filter hid its point.
   */
  selectedObject?: SpaceObject | null
  simTime: number
  onSelect: (noradId: number | null) => void
  showOrbit?: boolean
  showStations?: boolean
  showFootprint?: boolean
}

const AGENCY_COLOR: Record<string, number> = {
  NASA: 0x38bdf8,
  ISRO: 0xfbbf24,
  ESA: 0x818cf8,
  NOAA: 0x34d399,
  OTHER: 0xf43f5e,
}

/** Round sprite for satellite points — cheaper and crisper than a texture file. */
function makeDotTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.15)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

/** Sun direction in ECI, normalised — drives the day/night terminator. */
function sunDirection(date: Date) {
  const { rsun } = sunPos(jday(date))
  const magnitude = Math.hypot(rsun.x, rsun.y, rsun.z)
  return new THREE.Vector3(rsun.x / magnitude, rsun.y / magnitude, rsun.z / magnitude)
}

export function Globe3D({
  objects,
  states,
  stations,
  selectedId,
  selectedObject,
  simTime,
  onSelect,
  showOrbit = true,
  showStations = true,
  showFootprint = true,
}: Globe3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<{ name: string; x: number; y: number } | null>(null)

  // Everything mutable that the animation loop touches lives in one ref so the
  // effect below can stay a true mount-once setup.
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    earthGroup: THREE.Group
    sunLight: THREE.DirectionalLight
    satPoints: THREE.Points
    satGeometry: THREE.BufferGeometry
    orbitLine: THREE.Line
    orbitGhost: THREE.Line
    footprint: THREE.Line
    stationGroup: THREE.Group
    raycaster: THREE.Raycaster
    pointer: THREE.Vector2
  } | null>(null)

  // The animation loop needs the latest mission time without the scene being
  // torn down and rebuilt on every clock tick, so it reads through a ref that
  // is refreshed after each render.
  const simTimeRef = useRef(simTime)
  useEffect(() => {
    simTimeRef.current = simTime
  })

  // Regenerating the orbit ring every tick would be wasted work; once a minute
  // of mission time is visually indistinguishable.
  const orbitBucket = Math.floor(simTime / 60_000)

  // ── Scene setup (once) ────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100)
    camera.up.set(0, 0, 1) // ECI: north is +Z
    camera.position.set(2.6, -2.4, 1.9)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.rotateSpeed = 0.5
    controls.minDistance = 1.35
    controls.maxDistance = 12
    controls.enablePan = false

    // ── Earth-fixed group ───────────────────────────────────────────────
    const earthGroup = new THREE.Group()
    scene.add(earthGroup)

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 48),
      new THREE.MeshPhongMaterial({
        color: 0x0a1a2e,
        emissive: 0x030a14,
        specular: 0x1b3a5c,
        shininess: 12,
      }),
    )
    sphere.rotateX(Math.PI / 2) // move the geometry's poles onto +Z/-Z
    earthGroup.add(sphere)

    const graticule = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(graticuleSegments(15), 3),
      ),
      new THREE.LineBasicMaterial({ color: 0x1e4d6b, transparent: true, opacity: 0.32 }),
    )
    earthGroup.add(graticule)

    const coastlines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x3ea8c7, transparent: true, opacity: 0.75 }),
    )
    earthGroup.add(coastlines)

    loadLandOutlines().then((rings) => {
      if (rings.length === 0) return
      coastlines.geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(ringsToSegments(rings), 3),
      )
      coastlines.geometry.computeBoundingSphere()
    })

    const stationGroup = new THREE.Group()
    earthGroup.add(stationGroup)

    // ── Atmosphere ──────────────────────────────────────────────────────
    // A back-face sphere whose opacity rises at grazing angles: a cheap
    // Fresnel rim that reads as atmosphere from any camera position.
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 48, 32),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(0x2ea8e0) } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vNormal;
          void main() {
            float rim = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
            gl_FragColor = vec4(uColor, clamp(rim, 0.0, 1.0) * 0.55);
          }
        `,
      }),
    )
    scene.add(atmosphere)

    // ── Lighting ────────────────────────────────────────────────────────
    const sunLight = new THREE.DirectionalLight(0xfff2dd, 2.1)
    scene.add(sunLight)
    scene.add(new THREE.AmbientLight(0x2a4a6a, 0.55))

    // ── Satellites ──────────────────────────────────────────────────────
    const satGeometry = new THREE.BufferGeometry()
    satGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
    satGeometry.setAttribute('color', new THREE.Float32BufferAttribute([], 3))

    const satPoints = new THREE.Points(
      satGeometry,
      new THREE.PointsMaterial({
        size: 0.055,
        map: makeDotTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        sizeAttenuation: true,
        blending: THREE.AdditiveBlending,
      }),
    )
    scene.add(satPoints)

    // The orbit is drawn twice: once normally, so the half in front of Earth
    // reads as solid, and once with depth testing off, so the half behind the
    // planet still shows as a faint ghost. A low orbit otherwise disappears
    // almost entirely behind the globe.
    const orbitGeometry = new THREE.BufferGeometry()
    const orbitLine = new THREE.Line(
      orbitGeometry,
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 }),
    )
    const orbitGhost = new THREE.Line(
      orbitGeometry,
      new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.22,
        depthTest: false,
      }),
    )
    orbitGhost.renderOrder = -1
    scene.add(orbitLine)
    scene.add(orbitGhost)

    const footprint = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 }),
    )
    scene.add(footprint)

    const raycaster = new THREE.Raycaster()
    raycaster.params.Points = { threshold: 0.045 }
    const pointer = new THREE.Vector2()

    sceneRef.current = {
      renderer, scene, camera, controls, earthGroup, sunLight,
      satPoints, satGeometry, orbitLine, orbitGhost, footprint, stationGroup, raycaster, pointer,
    }

    // ── Resize ──────────────────────────────────────────────────────────
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    // ── Render loop ─────────────────────────────────────────────────────
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      const date = new Date(simTimeRef.current)

      earthGroup.rotation.z = gstime(date)
      sunLight.position.copy(sunDirection(date).multiplyScalar(50))

      controls.update()
      renderer.render(scene, camera)
    }
    render()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
          obj.geometry.dispose()
          const material = obj.material
          if (Array.isArray(material)) material.forEach((m) => m.dispose())
          else material.dispose()
        }
      })
      mount.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [])

  // ── Satellite positions ───────────────────────────────────────────────
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return

    const positions: number[] = []
    const colors: number[] = []
    const color = new THREE.Color()

    for (const obj of objects) {
      const state = states[obj.noradId]
      if (!state) continue

      positions.push(
        state.eci.x / EARTH_RADIUS_KM,
        state.eci.y / EARTH_RADIUS_KM,
        state.eci.z / EARTH_RADIUS_KM,
      )

      const base = obj.noradId === selectedId ? 0xffffff : AGENCY_COLOR[obj.agency] ?? 0x94a3b8
      color.setHex(base)
      // Objects in eclipse are dimmed: an operator can read the terminator off
      // the constellation itself, not just off the planet.
      if (!state.sunlit) color.multiplyScalar(0.45)
      colors.push(color.r, color.g, color.b)
    }

    ctx.satGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    ctx.satGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    ctx.satGeometry.computeBoundingSphere()
  }, [objects, states, selectedId])

  // ── Selected orbit and footprint ──────────────────────────────────────
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return

    const selected = selectedObject ?? objects.find((o) => o.noradId === selectedId)
    const visible = Boolean(selected) && showOrbit
    ctx.orbitLine.visible = visible
    ctx.orbitGhost.visible = visible

    if (selected && visible) {
      const path = orbitPathEci(selected, new Date(simTime), 160)
      const flat = path.flatMap((p) => [p.x / EARTH_RADIUS_KM, p.y / EARTH_RADIUS_KM, p.z / EARTH_RADIUS_KM])
      // Both lines share one geometry, so this updates the solid and the ghost.
      ctx.orbitLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3))
      ctx.orbitLine.geometry.computeBoundingSphere()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucketed on purpose
  }, [objects, selectedObject, selectedId, showOrbit, orbitBucket])

  // ── Ground stations ───────────────────────────────────────────────────
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return

    ctx.stationGroup.clear()
    ctx.stationGroup.visible = showStations

    // One geometry and one material shared by every marker; disposed together
    // when the station list changes.
    const geometry = new THREE.SphereGeometry(0.012, 10, 8)
    const material = new THREE.MeshBasicMaterial({ color: 0x34d399 })

    for (const station of stations) {
      const marker = new THREE.Mesh(geometry, material)
      const v = geodeticToVec3(station.lat, station.lon, station.altKm)
      marker.position.set(v.x, v.y, v.z)
      ctx.stationGroup.add(marker)
    }

    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [stations, showStations])

  // ── Footprint circle under the selected satellite ─────────────────────
  useEffect(() => {
    const ctx = sceneRef.current
    if (!ctx) return

    const state = selectedId !== null ? states[selectedId] : null
    if (!state || !showFootprint) {
      ctx.footprint.visible = false
      return
    }

    // Build the circle in the Earth-fixed frame, then rotate it into ECI so it
    // stays glued to the ground under the satellite.
    const centralAngle = Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + state.altKm))
    const ground = geodeticToVec3(state.lat, state.lon)
    const centre = new THREE.Vector3(ground.x, ground.y, ground.z).normalize()

    const basisA = new THREE.Vector3(0, 0, 1).cross(centre)
    if (basisA.lengthSq() < 1e-6) basisA.set(1, 0, 0)
    basisA.normalize()
    const basisB = new THREE.Vector3().crossVectors(centre, basisA).normalize()

    const gmst = gstime(new Date(state.timestamp))
    const points: number[] = []
    for (let i = 0; i <= 72; i++) {
      const theta = (i / 72) * Math.PI * 2
      const v = centre
        .clone()
        .multiplyScalar(Math.cos(centralAngle))
        .addScaledVector(basisA, Math.sin(centralAngle) * Math.cos(theta))
        .addScaledVector(basisB, Math.sin(centralAngle) * Math.sin(theta))
        .multiplyScalar(1.004)
      v.applyAxisAngle(new THREE.Vector3(0, 0, 1), gmst)
      points.push(v.x, v.y, v.z)
    }

    ctx.footprint.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    ctx.footprint.geometry.computeBoundingSphere()
    ctx.footprint.visible = true
  }, [selectedId, states, showFootprint])

  // ── Picking ───────────────────────────────────────────────────────────
  const pick = (event: { clientX: number; clientY: number }) => {
    const ctx = sceneRef.current
    const mount = mountRef.current
    if (!ctx || !mount) return null

    const rect = mount.getBoundingClientRect()
    ctx.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    ctx.raycaster.setFromCamera(ctx.pointer, ctx.camera)
    const hits = ctx.raycaster.intersectObject(ctx.satPoints)
    if (hits.length === 0 || hits[0].index === undefined) return null

    // The points buffer only contains objects that propagated successfully, so
    // rebuild the same filtered order to map an index back to a NORAD id.
    const visible = objects.filter((o) => states[o.noradId])
    return visible[hits[0].index] ?? null
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={mountRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onPointerMove={(event) => {
          const hit = pick(event)
          const rect = mountRef.current?.getBoundingClientRect()
          if (hit && rect) {
            setHovered({ name: hit.name, x: event.clientX - rect.left, y: event.clientY - rect.top })
          } else {
            setHovered(null)
          }
        }}
        onPointerLeave={() => setHovered(null)}
        onClick={(event) => {
          const hit = pick(event)
          if (hit) onSelect(hit.noradId)
        }}
      />

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-y-8 translate-x-3 rounded border border-line bg-deep/95 px-2 py-1 font-mono text-[10px] text-ink"
          style={{ left: hovered.x, top: hovered.y }}
        >
          {hovered.name}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1">
        {Object.entries(AGENCY_COLOR).map(([agency, color]) => (
          <span key={agency} className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: `#${color.toString(16).padStart(6, '0')}` }} />
            {agency}
          </span>
        ))}
      </div>
    </div>
  )
}
