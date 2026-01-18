/*!
 * PlayCanvas plugin for encantar.js
 * @author Victor M. Feliz (MotivaCG) and Alexandre Martins
 * @license LGPL-3.0-or-later
 */

/* Usage of the indicated versions is encouraged */
USING({
    'encantar.js': { version: '0.4.6' },
     'playcanvas': { version: '2.13.0' }
});

/**
 * Base class for Augmented Reality experiences
 * @abstract
 */
class ARDemo
{
    /**
     * Start the AR session
     * @returns {Promise<Session> | SpeedyPromise<Session>}
     * @abstract
     */
    startSession()
    {
        throw new Error('Abstract method');
    }

    /**
     * Initialization
     * @returns {void | Promise<void>}
     */
    init()
    {
        return Promise.resolve();
    }

    /**
     * Animation step - called every frame
     * @returns {void}
     */
    update()
    {
    }

    /**
     * Release resources
     * @returns {void}
     */
    release()
    {
    }

    /**
     * Preload resources before starting the AR session
     * @returns {Promise<void>}
     */
    preload()
    {
        return Promise.resolve();
    }

    /**
     * A reference to the ARSystem
     * @returns {ARSystem | null}
     */
    get ar()
    {
        return this._ar;
    }

    /**
     * User-provided canvas (optional)
     * If provided, use it in your AR Viewport
     * @returns {HTMLCanvasElement | null}
     */
    get canvas()
    {
        return null;
    }

    /**
     * Constructor
     */
    constructor()
    {
        this._ar = null;
    }
}

/**
 * AR Utilities
 */
class ARUtils
{
    /**
     * Convert an AR Vector2 to a PlayCanvas Vec2
     * @param {Vector2} v
     * @returns {pc.Vec2}
     */
    convertVector2(v)
    {
        return new pc.Vec2(v.x, v.y);
    }

    /**
     * Convert an AR Vector3 to a PlayCanvas Vec3
     * @param {Vector3} v
     * @returns {pc.Vec3}
     */
    convertVector3(v)
    {
        return new pc.Vec3(v.x, v.y, v.z);
    }

    /**
     * Convert an AR Quaternion to a PlayCanvas Quat
     * @param {Quaternion} q
     * @returns {pc.Quat}
     */
    convertQuaternion(q)
    {
        return new pc.Quat(q.x, q.y, q.z, q.w);
    }

    /**
     * Convert an AR Ray to a PlayCanvas Ray
     * @param {Ray} r
     * @returns {pc.Ray}
     */
    convertRay(r)
    {
        const origin = this.convertVector3(r.origin);
        const direction = this.convertVector3(r.direction);
        return new pc.Ray(origin, direction);
    }
}

/**
 * Helper for creating Augmented Reality experiences
 */
class ARSystem
{
    /**
     * AR Session
     * @returns {Session}
     */
    get session()
    {
        return this._session;
    }

    /**
     * Current frame: an object holding data to augment the physical scene.
     * If the AR scene is not initialized, this will be null.
     * @returns {Frame | null}
     */
    get frame()
    {
        return this._frame;
    }

    /**
     * AR Viewer
     * @returns {Viewer | null}
     */
    get viewer()
    {
        return this._viewer;
    }

    /**
     * Pointer-based input (current frame)
     * @returns {TrackablePointer[]}
     */
    get pointers()
    {
        return this._pointers;
    }

    /**
     * The root is an Entity that is automatically aligned to the physical scene.
     * Objects of your virtual scene should be children of this entity.
     * @returns {pc.Entity}
     */
    get root()
    {
        return this._root;
    }

    /**
     * The PlayCanvas Application
     * @returns {pc.Application}
     */
    get app()
    {
        return this._app;
    }

    /**
     * A camera Entity that is automatically adjusted for AR
     * @returns {pc.Entity}
     */
    get camera()
    {
        return this._camera;
    }

    /**
     * AR Utilities
     * @returns {ARUtils}
     */
    get utils()
    {
        return this._utils;
    }

    /**
     * Constructor
     */
    constructor()
    {
        this._session = null;
        this._frame = null;
        this._viewer = null;
        this._pointers = [];
        this._origin = null;
        this._root = null;
        this._app = null;
        this._camera = null;
        this._utils = new ARUtils();
    }
}

/**
 * Enchant PlayCanvas with encantar.js!
 * @param {ARDemo} demo
 * @returns {Promise<ARSystem>}
 */
function encantar(demo)
{
    console.log('[plugin] === VERSION TEST-013 ===');
    
    const ar = new ARSystem();
    let _mat = null;
    let _pos = null;
    let _rot = null;
    let _scl = null;
    let _lastTimestamp = 0;

    function animate(time, frame)
    {
        try {
            // Log first frame
            if(!animate._started) {
                console.log('[plugin] animate(): FIRST FRAME RECEIVED!');
                animate._started = true;
            }
            
            // Log periodically
            if(!animate._frameCount) animate._frameCount = 0;
            animate._frameCount++;
            /*if(animate._frameCount % 60 === 0) {
                console.log('[plugin] animate(): frame', animate._frameCount);
            }*/
            
            ar._frame = frame;
            mix(frame);

            demo.update();

            // Render the scene
            ar._app.render();
            
            ar._session.requestAnimationFrame(animate);
        } catch(error) {
            console.error('[plugin] animate() ERROR:', error);
        }
    }

    function mix(frame)
    {
        let found = false;
        ar._viewer = null;
        ar._pointers.length = 0;
        
        // Log frame results periodically
        if(!mix._frameCount) mix._frameCount = 0;
        mix._frameCount++;
        
        /*if(mix._frameCount % 60 === 0) {
            console.log('[plugin] mix(): frame.results count:', frame.results.length);
            for(const result of frame.results) {
                console.log('[plugin] mix(): result type check - image-tracker:', result.of('image-tracker'), ', trackables:', result.trackables ? result.trackables.length : 'N/A');
            }
        }*/

        for(const result of frame.results) {
            if(result.of('image-tracker')) {
                if(result.trackables.length > 0) {
                    const trackable = result.trackables[0];
                    const perspectiveView = result.viewer.view;
                    const viewMatrixInverse = result.viewer.pose.transform.matrix;
                    const modelMatrix = trackable.pose.transform.matrix;

                    align(perspectiveView, viewMatrixInverse, modelMatrix);
                    ar._origin.enabled = true;
                    ar._viewer = result.viewer;

                    found = true;
                    
                    // Debug log (only once per second to avoid spam)
                    /*if(!mix._lastLog || Date.now() - mix._lastLog > 1000) {
                        console.log('[plugin] mix(): TARGET FOUND! origin.enabled:', ar._origin.enabled);
                        console.log('[plugin] mix(): origin position:', ar._origin.getPosition().toString());
                        console.log('[plugin] mix(): root.enabled:', ar._root.enabled);
                        mix._lastLog = Date.now();
                    }*/
                }
            }
            else if(result.of('pointer-tracker')) {
                if(result.trackables.length > 0)
                    ar._pointers.push.apply(ar._pointers, result.trackables);
            }
        }

        if(!found)
            ar._origin.enabled = !!demo.debugAlwaysVisible ? true : false;
    }

    function align(perspectiveView, viewMatrixInverse, modelMatrix)
    {
        // 1. Update Camera Projection
        const camComp = ar._camera.camera;
        _mat.data.set(perspectiveView.projectionMatrix.read());
        camComp.projectionMatrix.copy(_mat);

        // Update projection parameters for camera component
        camComp.nearClip = perspectiveView.near;
        camComp.farClip = perspectiveView.far;
        camComp.fov = perspectiveView.fovy * pc.math.RAD_TO_DEG;
        camComp.aspectRatio = perspectiveView.aspect;

        // 2. Update Camera Pose (View Matrix Inverse)
        _mat.data.set(viewMatrixInverse.read());
        _mat.getTranslation(_pos);
        _mat.getScale(_scl);
        _rot.setFromMat4(_mat);
        ar._camera.setPosition(_pos);
        ar._camera.setRotation(_rot);

        // 3. Update Origin/Root Pose (Model Matrix)
        _mat.data.set(modelMatrix.read());
        _mat.getTranslation(_pos);
        _mat.getScale(_scl);
        _rot.setFromMat4(_mat);
        ar._origin.setPosition(_pos);
        ar._origin.setRotation(_rot);
        ar._origin.setLocalScale(_scl);
    }

    function create3DEngine(canvas)
    {
        ar._app = new pc.Application(canvas, {
            graphicsDeviceOptions: {
                alpha: true,
                preserveDrawingBuffer: false,
                antialias: true
            },
            mouse: new pc.Mouse(canvas),
            touch: new pc.TouchDevice(canvas)
        });
    }

    function awake()
    {
        console.log('[plugin] awake() called');
        demo._ar = ar;
        console.log('[plugin] demo._ar assigned:', demo._ar);
        console.log('[plugin] demo.canvas:', demo.canvas);

        // PlayCanvas requires the app to exist before preloading assets
        // Prefer reusing an existing app (if provided) to avoid creating TWO PlayCanvas apps
        // that fight for the same canvas (which breaks GSplat/asset rendering).
        if(demo.app) {
            ar._app = demo.app;
            console.log('[plugin] Reusing existing PlayCanvas app from demo.app');
        }

        // Otherwise, create the 3D engine now if a canvas is provided
        if(!ar._app && demo.canvas !== null) {
            console.log('[plugin] Creating 3D engine...');
            create3DEngine(demo.canvas);
            demo.canvas.hidden = true;
            
            // Start the app early so assets can be loaded during preload()
            ar._app.start();
            console.log('[plugin] App started, ar._app:', ar._app);
        } else if(!ar._app) {
            console.log('[plugin] WARNING: demo.canvas is null and demo.app not provided!');
        }
    }

    // start the lifecycle
    return Promise.resolve()
    .then(() => awake())
    .then(() => demo.preload())
    .then(() => demo.startSession())
    .then(session => {

        ar._session = session;

        // Initialize PlayCanvas Application
        if(!ar._app) {
            create3DEngine(session.viewport.canvas);
        }
        else {
            // Validate canvas match when reusing an existing app
            const existingCanvas = ar._app.graphicsDevice && ar._app.graphicsDevice.canvas;
            if(existingCanvas && existingCanvas !== session.viewport.canvas) {
                session.end();
                throw new Error('ar-canvas mismatch');
            }

            // If the app was provided externally, prevent a second start()
            if(demo.app) {
                ar._app._appStarted = true;
            }
        }

        const { width, height } = session.viewport.virtualSize;
        ar._app._allowResize = false;
        ar._app.setCanvasFillMode(pc.FILLMODE_NONE, width, height);
        ar._app.setCanvasResolution(pc.RESOLUTION_FIXED, width, height);
        ar._app.autoRender = false;
        
        // Only start if not already started during awake() / externally
        if (!ar._app._appStarted) {
            // If demo.app exists, the app is managed by the caller
            if (!demo.app) {
                ar._app.start();
            }
        }
        ar._app._appStarted = true;

        // Setup helper objects for matrix math
        _mat = new pc.Mat4();
        _pos = new pc.Vec3();
        _rot = new pc.Quat();
        _scl = new pc.Vec3();

        // Setup Scene Hierarchy
        ar._origin = new pc.Entity('ar-origin');
        ar._origin.enabled = !!demo.debugAlwaysVisible ? true : false;
        ar._app.root.addChild(ar._origin);

        ar._root = new pc.Entity('ar-root');
        ar._origin.addChild(ar._root);
        
        console.log('[plugin] Scene hierarchy setup complete');
        console.log('[plugin] ar._origin.enabled:', ar._origin.enabled);
        console.log('[plugin] ar._root.enabled (own):', ar._root._enabled); // Internal state
        console.log('[plugin] ar._root.enabled (getter):', ar._root.enabled); // May inherit from parent

        // Setup Camera
        ar._camera = new pc.Entity('ar-camera');
        ar._camera.addComponent('camera', {
            clearColor: new pc.Color(0, 0, 0, 0),
            aspectRatioMode: pc.ASPECT_MANUAL
        });
        ar._camera.camera.calculateProjection = function(mat) {
             mat.copy(this.projectionMatrix);
             return mat;
        };
        ar._app.root.addChild(ar._camera);

        // Event Listeners
        session.addEventListener('end', event => {
            ar._origin.enabled = !!demo.debugAlwaysVisible ? true : false;
            ar._viewer = null;
            ar._frame = null;
            ar._pointers.length = 0;
        });

        // Handle viewport resize
        session.viewport.addEventListener('resize', event => {
            const size = session.viewport.virtualSize;
            ar._app.setCanvasResolution(pc.RESOLUTION_FIXED, size.width, size.height);
            ar._app.setCanvasFillMode(pc.FILLMODE_NONE, size.width, size.height);
            
            // Update camera aspect ratio
            if (ar._camera && ar._camera.camera) {
                ar._camera.camera.aspectRatio = size.width / size.height;
            }
            
            // Force a render
            ar._app.renderNextFrame = true;
        });

        // Initialize the demo and start the main loop
        return Promise.resolve()
        .then(() => {
            console.log('[plugin] About to call demo.init()...');
            return demo.init();
        })
        .then(() => {
            console.log('[plugin] demo.init() completed, starting animation loop...');
            session.addEventListener('end', event => { demo.release(); });
            _lastTimestamp = performance.now();
            console.log('[plugin] Calling session.requestAnimationFrame(animate)...');
            session.requestAnimationFrame(animate);
            console.log('[plugin] Animation loop started!');
            return ar;
        })
        .catch(error => {
            console.error('[plugin] Error during init/loop start:', error);
            session.end();
            throw error;
        });

    })
    .catch(error => {
        console.error(error);
        throw error;
    });
}

/**
 * Version check
 * @param {object} libs
 */
function USING(libs)
{
    window.addEventListener('load', () => {
        try { AR, pc;
            const versionOf = { 'encantar.js': AR.version.replace(/-.*$/, ''), 'playcanvas': pc.version };
            const check = (x,v,w) => v != w ? console.warn(`\n\n\nWARNING\n\nThis plugin has been tested with ${x} version ${v}. The version in use is ${w}. Usage of ${x} version ${v} is recommended instead.\n\n\n`) : void 0;
            for(const [lib, expected] of Object.entries(libs))
                check(lib, expected.version, versionOf[lib]);
        }
        catch(e) {
            alert(e.message);
        }
    });
}