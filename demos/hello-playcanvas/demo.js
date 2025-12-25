/**
 * Augmented Reality demo using the PlayCanvas plugin for encantar.js
 * Ported from the Three.js/Babylon.js versions
 */

/**
 * Utilities for the Demo
 */
class PCUtils
{
    /**
     * Load a GLB container and return the entity with animations ready
     * @param {pc.Application} app 
     * @param {string} url 
     * @param {string} name 
     * @returns {Promise<{entity: pc.Entity, animations: Object}>}
     */
    static loadGLB(app, url, name) {
        return new Promise((resolve, reject) => {
            const asset = new pc.Asset(name, 'container', { url: url });
            app.assets.add(asset);
            app.assets.load(asset);
            
            asset.ready(() => {
                const resource = asset.resource;
                const entity = resource.instantiateRenderEntity();
                
                // Extract animation clips from the container
                const animations = {};
                if (resource.animations && resource.animations.length > 0) {
                    resource.animations.forEach(clip => {
                        animations[clip.name] = clip;
                    });
                }
                
                resolve({ entity, animations, resource });
            });
            
            asset.on('error', err => reject(err));
        });
    }

    /**
     * Load a texture from URL
     * @param {pc.Application} app 
     * @param {string} url 
     * @returns {Promise<pc.Asset>}
     */
    static loadTexture(app, url) {
        return new Promise((resolve, reject) => {
            app.assets.loadFromUrl(url, 'texture', (err, asset) => {
                if (err) reject(err);
                else resolve(asset);
            });
        });
    }

    /**
     * Create a plane with a texture (Unlit material)
     * @param {pc.Application} app 
     * @param {pc.Asset} textureAsset 
     * @returns {pc.Entity}
     */
    static createImagePlane(app, textureAsset)
    {
        const material = new pc.StandardMaterial();
        material.diffuse = new pc.Color(0, 0, 0);
        material.emissive = new pc.Color(1, 1, 1);
        material.emissiveMap = textureAsset.resource;
        material.opacityMap = textureAsset.resource;
        material.opacityMapChannel = 'a';
        material.blendType = pc.BLEND_NORMAL;
        material.useLighting = false;
        material.cull = pc.CULLFACE_NONE;
        material.depthWrite = false;
        material.update();

        const entity = new pc.Entity();
        entity.addComponent('render', {
            type: 'plane',
            material: material
        });

        return entity;
    }

    /**
     * Adjust root rotation for front view (similar to Three.js demo)
     * @param {ARSystem} ar 
     */
    static switchToFrontView(ar)
    {
        // PlayCanvas Y-up, rotate to match the expected view
        ar.root.setLocalEulerAngles(-90, 0, 0);
    }
}

/**
 * Augmented Reality Demo
 */
class EnchantedDemo extends ARDemo
{
    constructor()
    {
        super();
        this._objects = {};
        this._initialized = false;
    }

    /**
     * Start the AR session
     * @returns {Promise<Session>}
     */
    async startSession()
    {
        if(!AR.isSupported()) {
            throw new Error(
                'This device is not compatible with this AR experience.\n\n' +
                'User agent: ' + navigator.userAgent
            );
        }

        // 1. Setup Tracker
        const tracker = AR.Tracker.Image();
        await tracker.database.add([
            { name: 'mage', image: document.getElementById('mage') },
            { name: 'cat', image: document.getElementById('cat') }
        ]);

        // 2. Setup Viewport
        const viewport = AR.Viewport({
            canvas: this.canvas,
            container: document.getElementById('ar-viewport'),
            hudContainer: document.getElementById('ar-hud')
        });

        // 3. Setup Source
        const videoElement = document.getElementById('my-video');
        const source = videoElement ? AR.Source.Video(videoElement) : AR.Source.Camera();

        // 4. Start Session
        const session = await AR.startSession({
            mode: 'immersive',
            viewport: viewport,
            trackers: [ tracker ],
            sources: [ source ],
            stats: true,
            gizmos: true,
        });

        // UI Handling
        const scan = document.getElementById('scan');
        if(scan) scan.style.pointerEvents = 'none';

        tracker.addEventListener('targetfound', event => {
            session.gizmos.visible = false;
            if(scan) scan.hidden = true;
            this._onTargetFound(event.referenceImage);
        });

        tracker.addEventListener('targetlost', event => {
            session.gizmos.visible = true;
            if(scan) scan.hidden = false;
            this._onTargetLost(event.referenceImage);
        });

        return session;
    }

    /**
     * Preload assets
     * @returns {Promise<void>}
     */
    async preload()
    {
        const ar = this.ar;
        const app = ar.app;
        
        if (!app) {
            throw new Error('PlayCanvas app not initialized. Make sure canvas getter returns a valid canvas element.');
        }

        console.log('Preloading assets...');

        const [ texCircle, texText, mageData, catData ] = await Promise.all([
            PCUtils.loadTexture(app, '../assets/magic-circle.png'),
            PCUtils.loadTexture(app, '../assets/it-works.png'),
            PCUtils.loadGLB(app, '../assets/mage.glb', 'mage'),
            PCUtils.loadGLB(app, '../assets/cat.glb', 'cat')
        ]);

        this._objects.assets = { 
            texCircle, 
            texText, 
            mage: mageData,
            cat: catData
        };
        
        console.log('Assets loaded successfully');
    }
    
    /**
     * Initialization
     * @returns {Promise<void>}
     */
    async init()
    {
        const ar = this.ar;
        const app = ar.app;

        console.log('[demo] init() called');
        console.log('[demo] ar.root:', ar.root);

        // 1. Coordinate System Adjustment
        PCUtils.switchToFrontView(ar);
        ar.root.setLocalPosition(0, -0.8, 0);

        // 2. Lighting Setup
        const light = new pc.Entity('light');
        light.addComponent('light', {
            type: 'directional',
            color: new pc.Color(1, 1, 1),
            intensity: 1.0
        });
        light.setLocalEulerAngles(45, 30, 0);
        app.root.addChild(light);
        
        // Add ambient light
        app.scene.ambientLight = new pc.Color(0.4, 0.4, 0.4);

        // 3. Add a simple test cube to verify rendering works
        const testCube = new pc.Entity('test-cube');
        testCube.addComponent('render', {
            type: 'box'
        });
        testCube.setLocalScale(0.5, 0.5, 0.5);
        testCube.setLocalPosition(0, 0.5, 0);
        
        // Create a simple colored material for the cube
        const cubeMaterial = new pc.StandardMaterial();
        cubeMaterial.diffuse = new pc.Color(1, 0, 0); // Red
        cubeMaterial.update();
        testCube.render.meshInstances[0].material = cubeMaterial;
        
        ar.root.addChild(testCube);
        this._objects.testCube = testCube;
        console.log('[demo] Test cube added');

        // 4. Scene Composition
        const assets = this._objects.assets;
        this._initMagicCircle(assets.texCircle);
        this._initText(assets.texText);
        this._initMage(assets.mage);
        this._initCat(assets.cat);

        // Done!
        this._initialized = true;
        console.log('[demo] Scene initialized');
    }

    /**
     * Animation loop
     */
    update()
    {
        if (!this._initialized) return;

        const ar = this.ar;
        const delta = ar.session.time.delta;

        this._animateMagicCircle(delta);
        
        // TODO: Implement proper PlayCanvas animation system
        // For now, animations are disabled to test tracking
    }

    /**
     * User-provided canvas
     * @returns {HTMLCanvasElement | null}
     */
    get canvas()
    {
        const canvas = document.getElementById('ar-canvas');
        if(!canvas) throw new Error('Missing ar-canvas');
        return canvas;
    }

    // ------------------------------------------------------------------------

    _initMagicCircle(texture)
    {
        const magicCircle = PCUtils.createImagePlane(this.ar.app, texture);
        // PlayCanvas plane is XZ, scale X and Z for width/height
        magicCircle.setLocalScale(4, 1, 4);
        // No additional rotation needed - plane is already on ground
        
        this.ar.root.addChild(magicCircle);
        this._objects.magicCircle = magicCircle;
    }

    _initText(texture)
    {
        const text = PCUtils.createImagePlane(this.ar.app, texture);
        text.setLocalPosition(0, -0.5, 2);
        text.setLocalScale(3, 1, 1.5);
        // Rotate to face camera (plane is XZ by default, rotate around X to make it vertical)
        text.setLocalEulerAngles(90, 0, 0);

        this.ar.root.addChild(text);
        this._objects.text = text;
    }

    _initMage(mageData)
    {
        const { entity, animations, resource } = mageData;
        entity.setLocalScale(0.7, 0.7, 0.7);
        
        this.ar.root.addChild(entity);
        this._objects.mage = entity;

        // TODO: Implement PlayCanvas animation properly
        console.log('[demo] Mage animations available:', Object.keys(animations));
    }

    _initCat(catData)
    {
        const { entity, animations, resource } = catData;
        entity.setLocalScale(0.7, 0.7, 0.7);
        
        this.ar.root.addChild(entity);
        this._objects.cat = entity;
        
        // TODO: Implement PlayCanvas animation properly
        console.log('[demo] Cat animations available:', Object.keys(animations));
    }

    _animateMagicCircle(delta)
    {
        const DEGREES_PER_SEC = 360 / 8.0; // 1 rotation every 8 seconds
        // Rotate around Y axis (up vector for the ground plane)
        this._objects.magicCircle.rotateLocal(0, -DEGREES_PER_SEC * delta, 0);
    }

    _onTargetFound(referenceImage)
    {
        console.log('[demo] Target found:', referenceImage.name);
        
        if(!this._initialized) {
            alert(`Target "${referenceImage.name}" was found, but the 3D scene is not yet initialized!`);
            return;
        }

        console.log('[demo] Objects:', this._objects);
        console.log('[demo] ar.root:', this.ar.root);
        console.log('[demo] ar.root.enabled:', this.ar.root.enabled);

        switch(referenceImage.name) {
            case 'mage':
                this._objects.mage.enabled = true;
                this._objects.cat.enabled = false;
                this._objects.text.enabled = false;
                this._setCircleColor(0.75, 0.94, 1.0); // #beefff
                console.log('[demo] Mage enabled');
                break;

            case 'cat':
                this._objects.mage.enabled = false;
                this._objects.cat.enabled = true;
                this._objects.text.enabled = true;
                this._setCircleColor(1.0, 1.0, 0.67); // #ffffaa
                console.log('[demo] Cat enabled');
                break;
        }
    }

    _setCircleColor(r, g, b)
    {
        const meshInstances = this._objects.magicCircle.render.meshInstances;
        if (meshInstances.length > 0) {
            const material = meshInstances[0].material;
            material.emissive.set(r, g, b);
            material.update();
        }
    }

    _onTargetLost(referenceImage)
    {
        // Optional: handle target lost
    }
}

// Entry Point
function main()
{
    const demo = new EnchantedDemo();
    encantar(demo).catch(error => {
        console.error(error);
        alert(error.message);
    });
}

if(document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', main);
else
    main();