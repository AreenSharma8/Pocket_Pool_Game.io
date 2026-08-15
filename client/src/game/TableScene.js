import * as THREE from "three";
import {
    HALF_L, HALF_W, TABLE_SURFACE_Y, CUSHION_HEIGHT, RAIL_THICKNESS,
    BALL_RADIUS, POCKET_VISUAL_RADIUS, POCKETS, BALL_COLORS
} from "./constants.js";

// Owns the Three.js side of the table: renderer, scene, lighting, static
// table/rail/pocket meshes, and per-ball meshes kept in sync with physics bodies.
// This class only knows about *visuals* -- it has no idea about physics,
// rules, or turns; PoolMatch.js is what reads ball positions out of
// PhysicsWorld each frame and calls syncBallMesh() here to move the matching mesh.
export class TableScene {
    // Sets up the renderer attached to the given <canvas>, an empty scene with
    // a dark background/fog (so the table fades into the void at a distance
    // instead of showing a hard edge), and a camera. Then builds all the
    // static scenery (lights, table, pockets) once up front.
    constructor(canvas) {
        this.canvas = canvas;
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x050b18);
        this.scene.fog = new THREE.Fog(0x050b18, 4, 10);

        this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);

        this._buildLights();
        this._buildTable();
        this._buildPockets();

        this.ballMeshes = new Map();

        window.addEventListener("resize", () => this.resize());
        this.resize();
    }

    // Three lights: a soft overall ambient fill so nothing is pitch black, a
    // warm directional "sun" that casts the main shadows, and a cool blue
    // point light for a bit of rim/accent lighting so the table doesn't look flat.
    _buildLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.55);
        this.scene.add(ambient);

        const key = new THREE.DirectionalLight(0xfff3d6, 1.1);
        key.position.set(1.5, 3.2, 1.2);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.left = -1.6;
        key.shadow.camera.right = 1.6;
        key.shadow.camera.top = 1.6;
        key.shadow.camera.bottom = -1.6;
        this.scene.add(key);

        const rim = new THREE.PointLight(0x4f8cff, 0.4, 6);
        rim.position.set(-1.5, 1.5, -1.5);
        this.scene.add(rim);
    }

    // Builds the purely-visual table: the green felt plane, four wooden rail
    // meshes around the edge (these sit right on top of PhysicsWorld's
    // invisible cushion boxes -- this file never touches physics directly),
    // a solid apron underneath for a sense of thickness, and a large floor
    // plane so the table doesn't appear to float in empty space.
    _buildTable() {
        const feltGeo = new THREE.PlaneGeometry(HALF_L * 2, HALF_W * 2);
        const feltMat = new THREE.MeshStandardMaterial({ color: 0x0e6e4f, roughness: 0.95, metalness: 0.0 });
        const felt = new THREE.Mesh(feltGeo, feltMat);
        felt.rotation.x = -Math.PI / 2;
        felt.position.y = TABLE_SURFACE_Y;
        felt.receiveShadow = true;
        this.scene.add(felt);

        const railMat = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.6, metalness: 0.1 });
        const railY = TABLE_SURFACE_Y + CUSHION_HEIGHT / 2;
        const railOuterL = HALF_L + RAIL_THICKNESS;
        const railOuterW = HALF_W + RAIL_THICKNESS;

        // The two long rails (running along x, one at the "top" and one at the
        // "bottom" of the table). Drawn as single continuous strips for
        // simplicity -- unlike the physics cushions, these don't need gaps at
        // the pockets since they're purely decorative.
        const longRailGeo = new THREE.BoxGeometry(railOuterL * 2 + RAIL_THICKNESS * 2, CUSHION_HEIGHT, RAIL_THICKNESS);
        [-1, 1].forEach((zSign) => {
            const rail = new THREE.Mesh(longRailGeo, railMat);
            rail.position.set(0, railY, zSign * (railOuterW + RAIL_THICKNESS / 2));
            rail.castShadow = true;
            rail.receiveShadow = true;
            this.scene.add(rail);
        });

        // The two short rails, at each end of the table (running along z).
        const shortRailGeo = new THREE.BoxGeometry(RAIL_THICKNESS, CUSHION_HEIGHT, railOuterW * 2);
        [-1, 1].forEach((xSign) => {
            const rail = new THREE.Mesh(shortRailGeo, railMat);
            rail.position.set(xSign * (railOuterL + RAIL_THICKNESS / 2), railY, 0);
            rail.castShadow = true;
            rail.receiveShadow = true;
            this.scene.add(rail);
        });

        // Legs / apron for visual grounding
        const apronGeo = new THREE.BoxGeometry(railOuterL * 2 + RAIL_THICKNESS * 2, 0.5, railOuterW * 2 + RAIL_THICKNESS * 2);
        const apronMat = new THREE.MeshStandardMaterial({ color: 0x241407, roughness: 0.8 });
        const apron = new THREE.Mesh(apronGeo, apronMat);
        apron.position.set(0, TABLE_SURFACE_Y - 0.26, 0);
        apron.receiveShadow = true;
        this.scene.add(apron);

        const floorGeo = new THREE.PlaneGeometry(20, 20);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0x090f1e, roughness: 1 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = TABLE_SURFACE_Y - 0.51;
        floor.receiveShadow = true;
        this.scene.add(floor);
    }

    // Draws a simple dark cone/cylinder "hole" mesh at each of the 6 pocket
    // locations from constants.js -- purely decorative, sits just below the
    // felt surface so it reads as a hole rather than a bump.
    _buildPockets() {
        const pocketMat = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: 0.9 });
        const geo = new THREE.CylinderGeometry(POCKET_VISUAL_RADIUS, POCKET_VISUAL_RADIUS * 0.7, 0.05, 24);
        POCKETS.forEach((p) => {
            const mesh = new THREE.Mesh(geo, pocketMat);
            mesh.position.set(p.x, TABLE_SURFACE_Y - 0.01, p.z);
            this.scene.add(mesh);
        });
    }

    // Creates the visible sphere mesh for one ball, colored by its suit, and
    // remembers it under `id` so future frames can move it to match the
    // physics body of the same id. Called once per ball when a match starts.
    addBallMesh(id, suit, number) {
        const geo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
        const mat = new THREE.MeshStandardMaterial({
            color: BALL_COLORS[suit],
            roughness: 0.25,
            metalness: 0.05
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.ballMeshes.set(id, mesh);
        return mesh;
    }

    // Shows/hides a ball's mesh -- used when a ball is potted (hide) or a
    // scratched cue ball is placed back on the table (show again).
    setBallVisible(id, visible) {
        const mesh = this.ballMeshes.get(id);
        if (mesh) mesh.visible = visible;
    }

    // Copies a physics body's current position/rotation onto its matching
    // mesh. Called every frame for every ball still in play so what you see
    // always matches where the physics simulation actually put the ball.
    syncBallMesh(id, body) {
        const mesh = this.ballMeshes.get(id);
        if (!mesh) return;
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
    }

    // Keeps the renderer/camera aspect ratio matched to the canvas's actual
    // on-screen size -- called once at startup and again on every window resize.
    resize() {
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    // Draws one frame. Called every animation frame from PoolMatch's loop,
    // after ball meshes and the camera have been updated for that frame.
    render() {
        this.renderer.render(this.scene, this.camera);
    }

    // Releases the WebGL context/resources -- called when leaving a match
    // screen so a stale renderer doesn't keep using GPU memory in the background.
    dispose() {
        this.renderer.dispose();
    }
}
