(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.NOVA = {})));
}(this, (function (exports) { 'use strict';

	//适合大部分WebGL的APP设置
	let DefaultSettings = {
	  parent: document.body, //APP所在DOM容器
	  setCommonCSS: true, //设置默认CSS样式，无法滚动，超出区域不显示，取消所有内外边距
	  autoStart: true, //自动执行渲染循环和逻辑循环
	  autoResize: true, //自动拉伸自适应不同屏幕分辨率
	  VRSupport: false, //是否加载VR支持模块
	  renderer: {
	    clearColor: 0x000000, //渲染器的默认清除颜色
	    clearAlpha: 1, //渲染器的默认清除颜色的透明度
	    pixelRatio: window.devicePixelRatio || 1, //用于移动平台的清晰度
	    precision: 'highp', // 渲染精细度，默认为高
	    antialias: true, //是否开启抗锯齿
	    alpha: false, // 渲染器是否保存alpha缓冲
	  },
	  normalEventList: ['click', 'mousedown', 'mouseup', 'touchstart',
	    'touchend', 'touchmove', 'mousemove'
	  ], //默认开启的原生事件监听，不建议将所有的事件监听都写在里面，每一个事件监听都会增加一次射线法碰撞检测，如果不必要的事件过多会降低性能
	  hammerEventList: 'press tap pressup pan swipe', //默认hammer手势事件的监听，同normalEventList一样，用到什么加入什么，不要一大堆东西全塞进去
	};

	let NotFunctionError$1 = class extends Error {
	  constructor( message ) {
	    super( message );
	    this.name = 'NotFunctionError';
	    this.message = message || 'The object is not a function.';
	  }
	};

	class LoopManager {
	  constructor(cycleLevel = 1) {
	    //当它是true，不执行该循环
	    this.disable = false;
	    //记录循环次数
	    this.times = 0;
	    //每隔多少循环执行一次update，用于调整fps。数字越大，fps越低
	    this.cycleLevel = cycleLevel <= 0 ? 1 : cycleLevel;
	    this.functionMap = new Map();
	  }

	  update(time) {
	    if (this.disable || this.times % this.cycleLevel !== 0) {
	      return;
	    }
	    this.functionMap.forEach((value) => {
	      value();
	    });
	  }

	  add(func, key) {
	    if (typeof func !== 'function') {
	      throw new NotFunctionError$1();
	    } else {
	      if (key) {
	        this.functionMap.set(key, func);
	      } else {
	        key = Symbol();
	        this.functionMap.set(key, func);
	        return key;
	      }
	    }
	  }

	  removeAll() {
	    this.functionMap.clear();
	  }

	  remove(funcOrKey) {
	    if (typeof funcOrKey === 'function') {
	      this.functionMap.forEach((value, key) => {
	        if (value === funcOrKey) {
	          return this.functionMap.delete(key);
	        }
	      });
	      return false;
	    } else {
	      return this.functionMap.delete(funcOrKey);
	    }
	  }
	}

	class EventManager {
	  constructor(world) {
	    world.eventManager = this;
	    this.world = world;
	    this.disable = false;
	    this.isDeep = true;
	    this.receivers = world.receivers;
	    this.raycaster = new THREE.Raycaster();
	    this.centerRaycaster = new THREE.Raycaster();
	    this.selectedObj = null;
	    this.centerSelectedObj = null;
	    this.isDetectingEnter = true;
	    let normalEventList = world.app.options.normalEventList;

	    function normalEventToHammerEvent(event) {
	      return {
	        changedPointers: [event],
	        center: {
	          x: event.clientX,
	          y: event.clientY,
	        },
	        type: event.type,
	        target: event.target
	      };
	    }

	    for (let eventItem of normalEventList) {
	      world.app.parent.addEventListener(eventItem, (event) => {
	        if (this.disable) return;
	        this.raycastCheck(normalEventToHammerEvent(event));
	      });
	    }

	    try {
	      if (Hammer === undefined) {
	        return;
	      }
	    } catch (e) {
	      console.warn('Hammer没有引入，手势事件无法使用，只能使用基础的交互事件。');
	      return;
	    }
	    this.hammer = new Hammer(world.app.renderer.domElement);
	    console.log(world.app.options.hammerEventList);
	    this.hammer.on(world.app.options.hammerEventList, (event) => {
	    	if (this.disable) return;
	      this.raycastCheck(event);
	    });
	  }

	  raycastCheck(event) {
	    let vec2 = new THREE.Vector2(event.center.x / this.world.app.getWorldWidth() *
	      2 - 1, 1 - event.center.y / this.world.app.getWorldHeight() * 2);
	    this.raycaster.setFromCamera(vec2, this.world.camera);
	    let intersects = this.raycaster.intersectObjects(this.world.receivers,
	      this.isDeep);
	    let intersect;
	    for (let i = 0; i < intersects.length; i++) {
	      if (intersects[i].object.isPenetrated) {
	        continue;
	      } else {
	        intersect = intersects[i];
	        break;
	      }
	    }
	    if (intersect && intersect.object.events && intersect.object.events[event
	        .type]) {
	      intersect.object.events[event.type].run(event, intersect);
	    }
	  }
	}

	class World {
	  constructor(app, camera, clearColor) {
	    this.app = app;
	    this.scene = new THREE.Scene();
	    this.logicLoop = new LoopManager();
	    this.renderLoop = new LoopManager();
	    this.camera = camera || new THREE.PerspectiveCamera(45, app.getWorldWidth() /
	      app.getWorldHeight(), 0.01, 5000);
	    this.receivers = this.scene.children;
	    this.eventManager = new EventManager(this);
	    this.renderTargetParameters = {
	      minFilter: THREE.LinearFilter,
	      magFilter: THREE.LinearFilter,
	      format: THREE.RGBFormat,
	      stencilBuffer: false
	    };
	    this.isRTT = false;
	    this.clearColor = clearColor || 0;
	    this.fbo = new THREE.WebGLRenderTarget(this.app.getWorldWidth(),
	      this.app.getWorldHeight(), this.renderTargetParameters);
	    this.defaultRenderID = Symbol();
	    this.renderLoop.add(() => {
	      this.app.renderer.render(this.scene, this.camera);
	    }, this.defaultRenderID);
	  }

	  update(time) {
	    this.logicLoop.update(time);
	    this.renderLoop.update(time);
	  }

	  resize(width, height) {
	    if (this.camera.type === 'PerspectiveCamera') {
	      this.camera.aspect = width / height;
	      this.camera.updateProjectionMatrix();
	    } else {
	      this.camera.left = -width / 2;
	      this.camera.right = width / 2;
	      this.camera.top = height / 2;
	      this.camera.bottom = -height / 2;
	      this.camera.updateProjectionMatrix();
	    }
	  }
	}

	const APP_STOP = 0;
	const APP_RUNNING = 1;
	const APP_PAUSE = 2;
	const VERSION = '0.0.1';

	console.log("Nova framework for Three.js, version: %c " + VERSION, "color:blue");

	class VR {
	  constructor(app) {
	    this.app = app;
	    this.display = undefined;
	    this.polyfill = undefined;
	    this.isOpenVR = false;
	    this.vrEffect = undefined;
	    this.getVRDisplay();
	    this.createVREffect();
	  }

	  createVREffect() {
	    if (this.vrEffect) {
	      return;
	    }
	    if (!THREE.VREffect) {
	      console.warn("未引入VREffect.js，无法创建VR模式。");
	      return;
	    }
	    this.vrEffect = new THREE.VREffect(this.app.renderer);
	    this.vrEffect.setSize(this.app.renderer.domElement.clientWidth,
	      this.app.renderer.domElement.clientHeight, false);
	    this.vrEffect.isOpened = false;
	    this.vrEffect.updateId = Symbol();
	  }

	  setPolyfill() {
	    if (this.polyfill) {
	      return;
	    }
	    if (!window.WebVRPolyfill) {
	      console.warn("未引入WebVRPolyfill.js，无法创建VR兼容模式。");
	      return;
	    }
	    let config = (function() {
	      let config = {};
	      let q = window.location.search.substring(1);
	      if (q === '') {
	        return config;
	      }
	      let params = q.split('&');
	      let param, name, value;
	      for (let i = 0; i < params.length; i++) {
	        param = params[i].split('=');
	        name = param[0];
	        value = param[1];

	        // All config values are either boolean or float
	        config[name] = value === 'true' ? true :
	          value === 'false' ? false :
	          parseFloat(value);
	      }
	      return config;
	    })();
	    this.polyfill = new WebVRPolyfill(config);
	  }

	  getVRDisplay() {
	    if (!navigator.getVRDisplays) {
	      this.setPolyfill();
	    }
	    if(!navigator.getVRDisplays){
	    	return;
	    }
	    return navigator.getVRDisplays()
	      .then((vrDisplays) => {
	        if (vrDisplays.length) {
	          this.display = vrDisplays[0];
	          return this.display;
	        }
	        return "no";
	      }, (vrDisplays) => {
	        return "no";
	      });
	  }

	  open() {
	    if (!this.display || !this.vrEffect) {
	      console.warn("未发现VR设备或浏览器不兼容，无法进入VR模式。");
	      return;
	    }
	    this.app.renderLoop.add(() => {
	      this.vrEffect.render(this.app.world.scene, this.app.world.camera);
	    }, this.vrEffect.updateId);
	    this.display.requestPresent([{ source: this.app.renderer.domElement }]);
	  }

	  close() {
	    this.app.renderLoop.remove(this.vrEffect.updateId);
	  }
	}

	class App {
	  constructor(settings = {}) {
	    this.options = _.defaultsDeep(settings, DefaultSettings);
	    if (this.options.setCommonCSS) {
	      this.setCommonCSS();
	    }
	    this.parent = this.options.parent;
	    this.renderer = new THREE.WebGLRenderer({
	      antialias: this.options.renderer.antialias,
	      precision: this.options.renderer.precision,
	      alpha: this.options.renderer.alpha,
	    });
	    this.renderer.setClearColor(this.options.renderer.clearColor,
	      this.options.renderer.clearAlpha);
	    this.world = new World(this);
	    this.animationFrame;
	    this.state = APP_STOP;
	    this.logicLoop = new LoopManager();
	    this.renderLoop = new LoopManager();
	    window.addEventListener('resize', () => {
	      this.resize();
	    });
	    if (this.options.autoStart) {
	      this.start();
	    }
	    if (this.options.VRSupport) {
	      this.VR = new VR(this);
	    }
	  }

	  resize() {
	    let width = this.getWorldWidth();
	    let height = this.getWorldHeight();
	    this.world.resize(width, height);
	    this.renderer.setSize(width, height);
	    this.renderer.setPixelRatio(this.options.renderer.pixelRatio);
	  }

	  update(time) {
	    if (this.state === APP_RUNNING) {
	      this.logicLoop.update(time);
	      this.world.update(time);
	      this.renderLoop.update(time);
	    }
	    this.animationFrame = requestAnimationFrame(() => {
	      this.update();
	    });
	  }

	  setCommonCSS() {
	    document.write(
	      '<style>*{margin:0;padding:0} body{overflow:hidden}</style>');
	  }

	  getWorldWidth() {
	    return this.parent === document.body ? window.innerWidth :
	      this.parent.offsetWidth;
	  }

	  getWorldHeight() {
	    return this.parent === document.body ? window.innerHeight :
	      this.parent.offsetHeight;
	  }

	  start() {
	    if (this.state === APP_STOP) {
	      this.state = APP_RUNNING;
	      this.parent.appendChild(this.renderer.domElement);
	      this.resize();
	      this.update();
	    }
	  }

	  resume() {
	    if (this.state === APP_PAUSE) {
	      this.state = APP_RUNNING;
	    }
	  }

	  pause() {
	    if (this.state === APP_RUNNING) {
	      this.state = APP_PAUSE;
	    }
	  }

	  destroy() {
	    this.world.destroy();
	  }

	  openFullScreen() {
	    let container = this.parent;
	    this.isFullScreen = true;
	    if (container.requestFullscreen) {
	      container.requestFullscreen();
	    } else if (container.msRequestFullscreen) {
	      container.msRequestFullscreen();
	    } else if (container.mozRequestFullScreen) {
	      container.mozRequestFullScreen();
	    } else if (container.webkitRequestFullscreen) {
	      container.webkitRequestFullscreen();
	    } else {
	      this.isFullScreen = false;
	    }
	    return this.isFullScreen;
	  }

	  closeFullScreen() {
	    let container = document;
	    this.isFullScreen = false;
	    if (container.exitFullscreen) {
	      container.exitFullscreen();
	    } else if (container.mozCancelFullScreen) {
	      container.mozCancelFullScreen();
	    } else if (container.webkitExitFullScreen) {
	      container.webkitExitFullScreen();
	    } else if (container.msExitFullscreen) {
	      container.msExitFullscreen();
	    } else if (container.webkitCancelFullScreen) {
	      container.webkitCancelFullScreen();
	    } else if (container.webkitExitFullScreen) {
	      container.webkitCancelFullScreen();
	    }
	    return this.isFullScreen;
	  }

	  toggleFullScreen() {
	    if (this.isFullScreen) {
	      this.closeFullScreen();
	    } else {
	      this.openFullScreen();
	    }

	  }

	  screenshot() {
	    let w = window.open('', '');
	    w.document.title = "Nova Screenshot";
	    let img = new Image();
	    this.renderer.render(this.world.scene, this.world.camera);
	    img.src = app.renderer.domElement.toDataURL();
	    w.document.body.appendChild(img);
	  }
	}

	class Monitor {
	  constructor(world, option) {
	    this.option = option;
	    this.fullWidth = world.app.getWorldWidth();
	    this.fullHeight = world.app.getWorldHeight();
	    this.renderer = new THREE.WebGLRenderer();
	    this.world = world;
	    this.canvas = this.renderer.domElement;
	    this.renderer.setSize(this.fullWidth * option.width, this.fullHeight *
	      option.height);
	    this.renderer.setPixelRatio(window.devicePixelRatio);
	  }

	  setViewOffset() {
	    let viewX = this.fullWidth * this.option.left;
	    let viewY = this.fullHeight * this.option.top;
	    let viewWidth = this.fullWidth * this.option.width;
	    let viewHeight = this.fullHeight * this.option.height;
	    this.world.camera.setViewOffset(this.fullWidth, this.fullHeight, viewX,
	      viewY, viewWidth, viewHeight);
	  }

	  render() {
	    this.setViewOffset();
	    this.renderer.render(this.world.scene, this.world.camera);
	  }
	}

	class Transitioner {
	  constructor(app, world, texture, options = {}) {
	    this.options = _.defaults(options, {
	      'useTexture': true,
	      'transition': 0,
	      'speed': 10,
	      'texture': 5,
	      'loopTexture': true,
	      'isAnimate': true,
	      'threshold': 0.3
	    });
	    this.app = app;
	    this.targetWorld = world;
	    this.maskTexture = texture;
	    this.material = new THREE.ShaderMaterial({
	      uniforms: {
	        tDiffuse1: {
	          value: null
	        },
	        tDiffuse2: {
	          value: null
	        },
	        mixRatio: {
	          value: 0.0
	        },
	        threshold: {
	          value: 0.1
	        },
	        useTexture: {
	          value: 1
	        },
	        tMixTexture: {
	          value: this.maskTexture
	        }
	      },
	      vertexShader: `varying vec2 vUv;
        void main() {
        vUv = vec2( uv.x, uv.y );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
	      fragmentShader: `uniform float mixRatio;
        uniform sampler2D tDiffuse1;
        uniform sampler2D tDiffuse2;
        uniform sampler2D tMixTexture;
        uniform int useTexture;
        uniform float threshold;
        varying vec2 vUv;
        
        void main() {

        vec4 texel1 = texture2D( tDiffuse1, vUv );
        vec4 texel2 = texture2D( tDiffuse2, vUv );

        if (useTexture==1) {

        vec4 transitionTexel = texture2D( tMixTexture, vUv );
        float r = mixRatio * (1.0 + threshold * 2.0) - threshold;
        float mixf=clamp((transitionTexel.r - r)*(1.0/threshold), 0.0, 1.0);

        gl_FragColor = mix( texel1, texel2, mixf );
        } else {

        gl_FragColor = mix( texel2, texel1, mixRatio );

        }
        }`
	    });
	    let halfWidth = app.getWorldWidth() / 2;
	    let halfHeight = app.getWorldHeight() / 2;
	    this.world = new World(app, new THREE.OrthographicCamera(-halfWidth,
	      halfWidth, halfHeight, -halfHeight, -10, 10));

	    let geometry = new THREE.PlaneBufferGeometry(halfWidth * 2,
	      halfHeight * 2);

	    let quad = new THREE.Mesh(geometry, this.material);
	    this.world.scene.add(quad);

	    this.sceneA = world;
	    this.sceneB = app.world;

	    this.material.uniforms.tDiffuse1.value = this.sceneA.fbo.texture;
	    this.material.uniforms.tDiffuse2.value = this.sceneB.fbo.texture;

	    this.needChange = false;
	  }

	  setThreshold(value) {
	    this.material.uniforms.threshold.value = value;
	  }

	  useTexture(value) {
	    this.material.uniforms.useTexture.value = value ? 1 : 0;
	  }

	  setTexture(i) {
	    this.material.uniforms.tMixTexture.value = this.texture;
	  }

	  update() {
	    let value = Math.min(this.options.transition, 1);
	    value = Math.max(value, 0);
	    this.material.uniforms.mixRatio.value = value;
	    this.app.renderer.setClearColor(this.sceneB.clearColor || 0);
	    this.sceneB.update();
	    this.app.renderer.render(this.sceneB.scene, this.sceneB.camera, this.sceneB
	      .fbo, true);
	    this.app.renderer.setClearColor(this.sceneA.clearColor || 0);
	    this.sceneA.update();
	    this.app.renderer.render(this.sceneA.scene, this.sceneA.camera, this.sceneA
	      .fbo, true);
	    this.app.renderer.render(this.world.scene, this.world.camera, null, true);
	  }
	}

	class View {
	  constructor(world, camera, {
	    clearColor = 0x000000,
	    top = 0,
	    left = 0,
	    width = 1,
	    height = 1
	  }) {
	    this.world = world;
	    this.scene = world.scene;
	    this.worldWidth = world.app.getWorldWidth();
	    this.worldHeight = world.app.getWorldHeight();
	    this.renderer = world.app.renderer;
	    this.camera = camera || new THREE.PerspectiveCamera(45, this.worldWidth /
	      this.worldHeight, 0.01, 1000);
	    this.renderTargetParameters = {
	      minFilter: THREE.LinearFilter,
	      magFilter: THREE.LinearFilter,
	      format: THREE.RGBFormat,
	      stencilBuffer: false
	    };
	    this.isRTT = false;
	    this.clearColor = clearColor;
	    this.left = left;
	    this.top = top;
	    this.width = width;
	    this.height = height;

	    this.fbo = new THREE.WebGLRenderTarget(
	      this.worldWidth * this.width,
	      this.worldHeight * this.height, this.renderTargetParameters
	    );

	    this.resize();
	  }

	  render() {
	    var left = Math.floor(this.worldWidth * this.left);
	    var top = Math.floor(this.worldHeight * this.top);
	    var width = Math.floor(this.worldWidth * this.width);
	    var height = Math.floor(this.worldHeight * this.height);
	    this.renderer.setViewport(left, top, width, height);
	    this.renderer.setScissor(left, top, width, height);
	    this.renderer.setScissorTest(true);
	    this.renderer.setClearColor(this.clearColor);
	    this.renderer.render(this.scene, this.camera);
	  }

	  resize() {
	    this.worldWidth = this.world.app.getWorldWidth();
	    this.worldHeight = this.world.app.getWorldHeight();
	    let width = Math.floor(this.worldWidth * this.width);
	    let height = Math.floor(this.worldHeight * this.height);
	    if (this.camera.type === 'PerspectiveCamera') {
	      this.camera.aspect = width / height;
	      this.camera.updateProjectionMatrix();
	    } else {
	      this.camera.left = -width / 2;
	      this.camera.right = width / 2;
	      this.camera.top = height / 2;
	      this.camera.bottom = -height / 2;
	      this.camera.updateProjectionMatrix();
	    }
	  }
	}

	/**
	 * 用于事件处理
	 * 
	 * */
	class Signal {
	  constructor(type) {
	    this.type = type;
	    this.functionArr = [];
	  }

	  add(func) {
	    if (typeof func !== 'function') {
	      throw new NotFunctionError();
	    } else {
	      this.functionArr.push(func);
	    }
	  }

	  remove(func) {
	    return _.remove(this.functionArr, function(n) {
	      return n === func;
	    });
	  }

	  run(event, intersect) {
	    this.functionArr.forEach(
	      (func) => {
	        func(event, intersect);
	      });
	  }
	}

	/**
	 * 由于事件处理
	 * 
	 * */
	class Events {
	  constructor(list) {
	    list = list || ['press', 'tap', 'pressup', 'pan', 'swipe', 'click',
	      'mousedown', 'mouseup', 'touchstart', 'touchend', 'touchmove',
	      'mousemove'
	    ];
	    for (let eventItem of list) {
	      this[eventItem] = new Signal(eventItem);
	    }
	  }
	}

	class GUI extends THREE.Group {
	  constructor() {
	    super();
	    this.css = {
	      backgroundColor: "rgba(0,0,0,0)",
	      opacity: 1,
	      width: 1,
	      height: 1
	    };
	  }
	}

	class Body extends GUI {
	  constructor(world, css) {
	    super();
	    this.world = world;
	    this.distanceFromCamera = 50;
	    this.css = _.defaults(css || {}, this.css);
	    this.canvas = document.createElement("canvas");
	    var spriteMaterial = new THREE.SpriteMaterial({
	      map: this.canvas,
	      color: 0xffffff
	    });
	    this.element = new THREE.Sprite(spriteMaterial);
	    this.vector = new THREE.Vector3();
	    this.update();
	    this.add(this.element);
	  }

	  lockToScreen() {
	    var c = this.world.camera;
	    c.getWorldDirection(this.vector);
	    this.rotation.set(c.rotation.x, c.rotation.y, c.rotation.z);
	    this.position.set(c.position.x + this.vector.x * this.distanceFromCamera,
	      c.position.y +
	      this.vector.y * this.distanceFromCamera, c.position.z + this.vector.z *
	      this.distanceFromCamera
	    );
	  }

	  update() {
	    this.canvas.width = this.css.width;
	    this.canvas.height = this.css.height;
	    let ctx = this.canvas.getContext("2d");
	    ctx.fillStyle = this.css.backgroundColor;
	    ctx.fillRect(0, 0, this.css.width, this.css.height);
	    var texture = new THREE.CanvasTexture(this.canvas);
	    texture.generateMipmaps = false;
	    texture.minFilter = THREE.LinearFilter;
	    texture.magFilter = THREE.LinearFilter;
	    var spriteMaterial = new THREE.SpriteMaterial({
	      map: texture,
	      color: 0xffffff
	    });
	    this.element.material.dispose();
	    this.element.material = spriteMaterial;
	    this.element.scale.set(this.css.width / 4, this.css.height / 4, 1);
	  }
	}

	class Div extends GUI {
	  constructor(world, css) {
	    super();
	    this.world = world;
	    this.css = _.defaults(css || {}, this.css);
	    this.canvas = document.createElement("canvas");
	    var spriteMaterial = new THREE.SpriteMaterial({
	      map: canvas,
	      color: 0xffffff
	    });
	    this.element = new THREE.Sprite(spriteMaterial);
	    this.vector = new THREE.Vector3();
	    this.update();
	    this.add(this.element);
	  }

	  update() {
	    this.canvas.width = this.css.width;
	    this.canvas.height = this.css.height;
	    let ctx = this.canvas.getContext("2d");
	    ctx.fillStyle = this.css.backgroundColor;
	    ctx.fillRect(0, 0, this.css.width, this.css.height);
	    var texture = new THREE.CanvasTexture(this.canvas);
	    texture.generateMipmaps = false;
	    texture.minFilter = THREE.LinearFilter;
	    texture.magFilter = THREE.LinearFilter;
	    var spriteMaterial = new THREE.SpriteMaterial({
	      map: texture,
	      color: 0xffffff
	    });
	    this.element.material.dispose();
	    this.element.material = spriteMaterial;
	    this.element.scale.set(this.css.width / 4, this.css.height / 4, 1);
	  }
	}

	class Txt extends THREE.Mesh {
	  constructor(text, css) {
	    css = _.defaults(css || {}, {
	      fontStyle: "normal",
	      fontVariant: "normal",
	      fontSize: 12,
	      fontWeight: "normal",
	      fontFamily: "微软雅黑",
	      color: "#ffffff",
	      textAlign: "center",
	      backgroundColor: "rgba(0,0,0,0)",
	      opacity: 1,
	      width: 1,
	      height: 1,
	      scale: {
	        x: 0.25,
	        y: 0.25,
	        z: 1,
	      }
	    });
	    let canvas = document.createElement("canvas");
	    var material = new THREE.MeshBasicMaterial({
	      transparent: true,
	      needsUpdate: false,
	      color: 0xffffff
	    });
	    super(new THREE.PlaneBufferGeometry(css.width / 8, css.height / 8),
	      material);
	    this.text = text;
	    this.canvas = canvas;
	    this.css = css;
	    this.update();
	  }

	  update() {
	    this.canvas.width = this.css.width;
	    this.canvas.height = this.css.height;
	    let ctx = this.canvas.getContext("2d");
	    ctx.fillStyle = this.css.backgroundColor;
	    ctx.fillRect(0, 0, this.css.width, this.css.height);
	    ctx.textAlign = this.css.textAlign;
	    ctx.font = this.css.fontStyle + " " + this.css.fontVariant + " " + this
	      .css.fontWeight +
	      " " + this.css.fontSize + "px " + this.css.fontFamily;
	    ctx.fillStyle = this.css.color;
	    let width = ctx.measureText(this.text)
	      .width;
	    ctx.fillText(this.text, this.css.width / 2, this.css.height / 2 + this.css
	      .fontSize / 4);
	    var texture = new THREE.CanvasTexture(this.canvas);
	    texture.generateMipmaps = false;
	    texture.minFilter = THREE.LinearFilter;
	    texture.magFilter = THREE.LinearFilter;
	    this.material.map = texture;
	    this.scale.set(this.css.scale.x, this.css.scale.y, this.css.scale.z);
	    this.material.opacity = this.css.opacity;
	  }
	}

	class LoaderFactory {
	  constructor() {
	    let manager = new THREE.LoadingManager();
	    this.Resource = {
	      images: {},
	      materials: {},
	      textures: {},
	      models: {},
	      sounds: {},
	      fonts: {},
	      unloaded: {
	        textures: [],
	        models: [],
	        sounds: [],
	        fonts: [],
	        images: []
	      }
	    };

	    manager.onStart = (url, itemsLoaded, itemsTotal) => {
	      if (this.onStart && typeof this.onStart === 'function') {
	        this.onStart(url, itemsLoaded, itemsTotal);
	      }
	    };

	    manager.onLoad = () => {
	      if (this.onLoad && typeof this.onLoad === 'function') {
	        this.onLoad();
	      }
	    };

	    manager.onProgress = (url, itemsLoaded, itemsTotal) => {
	      if (this.onProgress && typeof this.onProgress === 'function') {
	        this.onProgress(url, itemsLoaded, itemsTotal);
	      }
	    };

	    manager.onError = (url) => {
	      if (this.onError && typeof this.onError === 'function') {
	        this.onError(url);
	      }
	    };

	    this.imageLoader = new THREE.ImageLoader(manager);
	    this.textureLoader = new THREE.TextureLoader(manager);
	    this.audioListener = new THREE.AudioListener(manager);
	  }

	  loadImage(key, src, sucFunc, errFunc) {
	    return this.imageLoader.load(src,
	      (data) => {
	        this.Resource.images[key] = data;
	        if (sucFunc) sucFunc(data);
	      }, undefined, (err) => {
	        this.Resource.unloaded.images.push(src);
	        if (errFunc) errFunc(err);
	      }
	    );
	  }

	  loadTexture(key, src, sucFunc, errFunc) {
	    return this.textureLoader.load(src,
	      (data) => {
	        this.Resource.textures[key] = data;
	        if (sucFunc) sucFunc(data);
	      }, undefined, (err) => {
	        this.Resource.unloaded.textures.push(src);
	        if (errFunc) errFunc(err);
	      }
	    );
	  }
	}

	let CopyShader = {
	  uniforms: {
	    'tDiffuse': { value: null },
	    'opacity': { value: 1.0 }
	  },

	  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,

	  fragmentShader: `
    uniform float opacity;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      gl_FragColor = opacity * texel;
    }`
	};

	class Pass {
	  constructor(effectComposer, renderToScreen = false) {
	    // if set to true, the pass is processed by the composer
	    this.enabled = true;
	    // if set to true, the pass indicates to swap read and write buffer after rendering
	    this.needsSwap = true;
	    // if set to true, the pass clears its buffer before rendering
	    this.clear = false;
	    // if set to true, the result of the pass is rendered to screen
	    this.renderToScreen = renderToScreen;
	    if (effectComposer) {
	      effectComposer.addPass(this);
	    }
	  }
	  setSize(width, height) {}
	  render(renderer, writeBuffer, readBuffer, delta, maskActive) {}
	}

	class ShaderPass extends Pass {
	  constructor(shader, effectComposer, renderToScreen = false,
	    textureID = "tDiffuse") {
	    super(effectComposer, renderToScreen);
	    this.textureID = textureID;

	    if (shader instanceof THREE.ShaderMaterial) {
	      this.uniforms = shader.uniforms;
	      this.material = shader;
	    } else if (shader) {
	      this.uniforms = THREE.UniformsUtils.clone(shader.uniforms);
	      this.material = new THREE.ShaderMaterial({
	        defines: shader.defines || {},
	        uniforms: this.uniforms,
	        vertexShader: shader.vertexShader,
	        fragmentShader: shader.fragmentShader
	      });
	    }

	    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	    this.scene = new THREE.Scene();
	    this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
	    this.quad.frustumCulled = false;
	    this.scene.add(this.quad);
	  }

	  render(renderer, writeBuffer, readBuffer) {
	    if (this.uniforms[this.textureID]) {
	      this.uniforms[this.textureID].value = readBuffer.texture;
	    }

	    this.quad.material = this.material;
	    if (this.renderToScreen) {
	      renderer.render(this.scene, this.camera);
	    } else {
	      renderer.render(this.scene, this.camera, writeBuffer, this.clear);
	    }
	  }
	}

	class RenderPass extends Pass {
	  constructor(scene, camera, overrideMaterial, clearColor, clearAlpha = 0) {
	    super();
	    this.scene = scene;
	    this.camera = camera;
	    this.overrideMaterial = overrideMaterial;
	    this.clearColor = clearColor;
	    this.clearAlpha = clearAlpha;
	    this.clear = true;
	    this.clearDepth = false;
	    this.needsSwap = false;
	  }

	  render(renderer, writeBuffer, readBuffer, delta, maskActive) {
	    let oldAutoClear = renderer.autoClear;
	    renderer.autoClear = false;
	    this.scene.overrideMaterial = this.overrideMaterial;
	    let oldClearColor, oldClearAlpha;
	    if (this.clearColor) {
	      oldClearColor = renderer.getClearColor()
	        .getHex();
	      oldClearAlpha = renderer.getClearAlpha();
	      renderer.setClearColor(this.clearColor, this.clearAlpha);
	    }
	    if (this.clearDepth) {
	      renderer.clearDepth();
	    }
	    renderer.render(this.scene, this.camera, this.renderToScreen ? undefined :
	      readBuffer, this.clear);
	    if (this.clearColor) {
	      renderer.setClearColor(oldClearColor, oldClearAlpha);
	    }
	    this.scene.overrideMaterial = undefined;
	    renderer.autoClear = oldAutoClear;
	  }
	}

	class EffectComposer {
	  constructor(world, options = {}, renderTarget) {
	    options = _.defaults(options, {
	      renderer: undefined,
	      camera: undefined,
	      scene: undefined,
	      overrideMaterial: undefined,
	      clearColor: undefined,
	      clearAlpha: 0
	    });
	    this.renderer = options.renderer || world.app.renderer;
	    if (renderTarget === undefined) {
	      let parameters = {
	        minFilter: THREE.LinearFilter,
	        magFilter: THREE.LinearFilter,
	        format: THREE.RGBAFormat,
	        stencilBuffer: false
	      };
	      let size = this.renderer.getDrawingBufferSize();
	      renderTarget = new THREE.WebGLRenderTarget(size.width, size.height,
	        parameters);
	      renderTarget.texture.name = 'EffectComposer.rt1';
	    }

	    this.renderTarget1 = renderTarget;
	    this.renderTarget2 = renderTarget.clone();
	    this.renderTarget2.texture.name = 'EffectComposer.rt2';
	    this.writeBuffer = this.renderTarget1;
	    this.readBuffer = this.renderTarget2;

	    this.passes = [];
	    this.copyPass = new ShaderPass(CopyShader);

	    this.addPass(new RenderPass(options.scene || world.scene,
	      options.scene || world.camera));
	  }

	  swapBuffers() {
	    let tmp = this.readBuffer;
	    this.readBuffer = this.writeBuffer;
	    this.writeBuffer = tmp;
	  }

	  addPass(pass) {
	    this.passes.push(pass);
	    let size = this.renderer.getDrawingBufferSize();
	    pass.setSize(size.width, size.height);
	  }

	  insertPass(pass, index) {
	    this.passes.splice(index, 0, pass);
	  }

	  render(delta) {
	    let maskActive = false;
	    let pass, i, il = this.passes.length;
	    for (i = 0; i < il; i++) {
	      pass = this.passes[i];
	      if (pass.enabled === false) continue;
	      pass.render(this.renderer, this.writeBuffer, this.readBuffer, delta,
	        maskActive);

	      if (pass.needsSwap) {
	        if (maskActive) {
	          let context = this.renderer.context;
	          context.stencilFunc(context.NOTEQUAL, 1, 0xffffffff);
	          this.copyPass.render(this.renderer, this.writeBuffer, this.readBuffer,
	            delta);
	          context.stencilFunc(context.EQUAL, 1, 0xffffffff);
	        }
	        this.swapBuffers();
	      }

	      if (THREE.MaskPass !== undefined) {
	        if (pass instanceof THREE.MaskPass) {
	          maskActive = true;
	        } else if (pass instanceof THREE.ClearMaskPass) {
	          maskActive = false;
	        }
	      }
	    }
	  }

	  reset(renderTarget) {
	    if (renderTarget === undefined) {
	      let size = this.renderer.getDrawingBufferSize();
	      renderTarget = this.renderTarget1.clone();
	      renderTarget.setSize(size.width, size.height);
	    }
	    this.renderTarget1.dispose();
	    this.renderTarget2.dispose();
	    this.renderTarget1 = renderTarget;
	    this.renderTarget2 = renderTarget.clone();
	    this.writeBuffer = this.renderTarget1;
	    this.readBuffer = this.renderTarget2;
	  }

	  setSize(width, height) {
	    this.renderTarget1.setSize(width, height);
	    this.renderTarget2.setSize(width, height);
	    for (let i = 0; i < this.passes.length; i++) {
	      this.passes[i].setSize(width, height);
	    }
	  }
	}

	let DotScreenShader = {
	  uniforms: {
	    "tDiffuse": { value: null },
	    "tSize": { value: new THREE.Vector2(256, 256) },
	    "center": { value: new THREE.Vector2(0.5, 0.5) },
	    "angle": { value: 1.57 },
	    "scale": { value: 1.0 }
	  },

	  vertexShader: [
	    "varying vec2 vUv;",
	    "void main() {",
	    "vUv = uv;",
	    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
	    "}"
	  ].join("\n"),

	  fragmentShader: [
	    "uniform vec2 center;",
	    "uniform float angle;",
	    "uniform float scale;",
	    "uniform vec2 tSize;",
	    "uniform sampler2D tDiffuse;",
	    "varying vec2 vUv;",
	    "float pattern() {",
	    "float s = sin( angle ), c = cos( angle );",
	    "vec2 tex = vUv * tSize - center;",
	    "vec2 point = vec2( c * tex.x - s * tex.y, s * tex.x + c * tex.y ) * scale;",
	    "return ( sin( point.x ) * sin( point.y ) ) * 4.0;",
	    "}",

	    "void main() {",
	    "vec4 color = texture2D( tDiffuse, vUv );",
	    "float average = ( color.r + color.g + color.b ) / 3.0;",
	    "gl_FragColor = vec4( vec3( average * 10.0 - 5.0 + pattern() ), color.a );",
	    "}"
	  ].join("\n")
	};

	class DotScreenPass extends Pass {
	  constructor(center, angle, scale, effectComposer, renderToScreen = false) {
	    super(effectComposer, renderToScreen);
	    this.uniforms = THREE.UniformsUtils.clone(DotScreenShader.uniforms);
	    if (center !== undefined) this.uniforms["center"].value.copy(center);
	    if (angle !== undefined) this.uniforms["angle"].value = angle;
	    if (scale !== undefined) this.uniforms["scale"].value = scale;

	    this.material = new THREE.ShaderMaterial({
	      uniforms: this.uniforms,
	      vertexShader: DotScreenShader.vertexShader,
	      fragmentShader: DotScreenShader.fragmentShader
	    });

	    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	    this.scene = new THREE.Scene();
	    this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
	    this.quad.frustumCulled = false; // Avoid getting clipped
	    this.scene.add(this.quad);
	  }

	  render(renderer, writeBuffer, readBuffer, delta, maskActive) {
	    this.uniforms["tDiffuse"].value = readBuffer.texture;
	    this.uniforms["tSize"].value.set(readBuffer.width, readBuffer.height);

	    this.quad.material = this.material;

	    if (this.renderToScreen) {
	      renderer.render(this.scene, this.camera);
	    } else {
	      renderer.render(this.scene, this.camera, writeBuffer, this.clear);
	    }
	  }
	}

	let GlitchShader = {
	  uniforms: {
	    "tDiffuse": { value: null }, //diffuse texture
	    "tDisp": { value: null }, //displacement texture for digital glitch squares
	    "byp": { value: 0 }, //apply the glitch ?
	    "amount": { value: 0.08 },
	    "angle": { value: 0.02 },
	    "seed": { value: 0.02 },
	    "seed_x": { value: 0.02 }, //-1,1
	    "seed_y": { value: 0.02 }, //-1,1
	    "distortion_x": { value: 0.5 },
	    "distortion_y": { value: 0.6 },
	    "col_s": { value: 0.05 }
	  },

	  vertexShader: [
	    "varying vec2 vUv;",
	    "void main() {",
	    "vUv = uv;",
	    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
	    "}"
	  ].join("\n"),

	  fragmentShader: [
	    "uniform int byp;", //should we apply the glitch ?
	    "uniform sampler2D tDiffuse;",
	    "uniform sampler2D tDisp;",

	    "uniform float amount;",
	    "uniform float angle;",
	    "uniform float seed;",
	    "uniform float seed_x;",
	    "uniform float seed_y;",
	    "uniform float distortion_x;",
	    "uniform float distortion_y;",
	    "uniform float col_s;",

	    "varying vec2 vUv;",

	    "float rand(vec2 co){",
	    "return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);",
	    "}",

	    "void main() {",
	    "if(byp<1) {",
	    "vec2 p = vUv;",
	    "float xs = floor(gl_FragCoord.x / 0.5);",
	    "float ys = floor(gl_FragCoord.y / 0.5);",
	    //based on staffantans glitch shader for unity https://github.com/staffantan/unityglitch
	    "vec4 normal = texture2D (tDisp, p*seed*seed);",
	    "if(p.y<distortion_x+col_s && p.y>distortion_x-col_s*seed) {",
	    "if(seed_x>0.){",
	    "p.y = 1. - (p.y + distortion_y);",
	    "}",
	    "else {",
	    "p.y = distortion_y;",
	    "}",
	    "}",
	    "if(p.x<distortion_y+col_s && p.x>distortion_y-col_s*seed) {",
	    "if(seed_y>0.){",
	    "p.x=distortion_x;",
	    "}",
	    "else {",
	    "p.x = 1. - (p.x + distortion_x);",
	    "}",
	    "}",
	    "p.x+=normal.x*seed_x*(seed/5.);",
	    "p.y+=normal.y*seed_y*(seed/5.);",
	    //base from RGB shift shader
	    "vec2 offset = amount * vec2( cos(angle), sin(angle));",
	    "vec4 cr = texture2D(tDiffuse, p + offset);",
	    "vec4 cga = texture2D(tDiffuse, p);",
	    "vec4 cb = texture2D(tDiffuse, p - offset);",
	    "gl_FragColor = vec4(cr.r, cga.g, cb.b, cga.a);",
	    //add noise
	    "vec4 snow = 200.*amount*vec4(rand(vec2(xs * seed,ys * seed*50.))*0.2);",
	    "gl_FragColor = gl_FragColor+ snow;",
	    "}",
	    "else {",
	    "gl_FragColor=texture2D (tDiffuse, vUv);",
	    "}",
	    "}"
	  ].join("\n")
	};

	class GlitchPass extends Pass {
	  constructor(size = 64, goWild = false, effectComposer, renderToScreen = false) {
	    super(effectComposer, renderToScreen);
	    this.uniforms = THREE.UniformsUtils.clone(GlitchShader.uniforms);
	    this.uniforms["tDisp"].value = this.generateHeightmap(size);

	    this.material = new THREE.ShaderMaterial({
	      uniforms: this.uniforms,
	      vertexShader: GlitchShader.vertexShader,
	      fragmentShader: GlitchShader.fragmentShader
	    });

	    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	    this.scene = new THREE.Scene();

	    this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), null);
	    this.quad.frustumCulled = false;
	    this.scene.add(this.quad);

	    this.goWild = false;
	    this.curF = 0;
	    this.generateTrigger();
	  }

	  render(renderer, writeBuffer, readBuffer, delta, maskActive) {
	    this.uniforms["tDiffuse"].value = readBuffer.texture;
	    this.uniforms['seed'].value = Math.random();
	    this.uniforms['byp'].value = 0;

	    if (this.curF % this.randX == 0 || this.goWild == true) {
	      this.uniforms['amount'].value = Math.random() / 30;
	      this.uniforms['angle'].value = THREE.Math.randFloat(-Math.PI, Math.PI);
	      this.uniforms['seed_x'].value = THREE.Math.randFloat(-1, 1);
	      this.uniforms['seed_y'].value = THREE.Math.randFloat(-1, 1);
	      this.uniforms['distortion_x'].value = THREE.Math.randFloat(0, 1);
	      this.uniforms['distortion_y'].value = THREE.Math.randFloat(0, 1);
	      this.curF = 0;
	      this.generateTrigger();
	    } else if (this.curF % this.randX < this.randX / 5) {
	      this.uniforms['amount'].value = Math.random() / 90;
	      this.uniforms['angle'].value = THREE.Math.randFloat(-Math.PI, Math.PI);
	      this.uniforms['distortion_x'].value = THREE.Math.randFloat(0, 1);
	      this.uniforms['distortion_y'].value = THREE.Math.randFloat(0, 1);
	      this.uniforms['seed_x'].value = THREE.Math.randFloat(-0.3, 0.3);
	      this.uniforms['seed_y'].value = THREE.Math.randFloat(-0.3, 0.3);
	    } else if (this.goWild == false) {
	      this.uniforms['byp'].value = 1;
	    }

	    this.curF++;
	    this.quad.material = this.material;

	    if (this.renderToScreen) {
	      renderer.render(this.scene, this.camera);
	    } else {
	      renderer.render(this.scene, this.camera, writeBuffer, this.clear);
	    }
	  }

	  generateTrigger() {
	    this.randX = THREE.Math.randInt(120, 240);
	  }

	  generateHeightmap(size) {
	    let dataArr = new Float32Array(size * size * 3);
	    let length = size * size;

	    for (let i = 0; i < length; i++) {
	      let val = THREE.Math.randFloat(0, 1);
	      dataArr[i * 3 + 0] = val;
	      dataArr[i * 3 + 1] = val;
	      dataArr[i * 3 + 2] = val;
	    }

	    let texture = new THREE.DataTexture(dataArr, size, size,
	      THREE.RGBFormat, THREE.FloatType);
	    texture.needsUpdate = true;
	    return texture;
	  }
	}

	let FXAAShader = {
	  uniforms: {
	    "tDiffuse": { value: null },
	    "resolution": { value: new THREE.Vector2(1 / 1024, 1 / 512) }
	  },

	  vertexShader: [
	    "varying vec2 vUv;",
	    "void main() {",
	    "vUv = uv;",
	    "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
	    "}"
	  ].join("\n"),

	  fragmentShader: [
	    "precision highp float;",
	    "",
	    "uniform sampler2D tDiffuse;",
	    "",
	    "uniform vec2 resolution;",
	    "",
	    "varying vec2 vUv;",
	    "",
	    "// FXAA 3.11 implementation by NVIDIA, ported to WebGL by Agost Biro (biro@archilogic.com)",
	    "",
	    "//----------------------------------------------------------------------------------",
	    "// File:        es3-kepler\FXAA\assets\shaders/FXAA_DefaultES.frag",
	    "// SDK Version: v3.00",
	    "// Email:       gameworks@nvidia.com",
	    "// Site:        http://developer.nvidia.com/",
	    "//",
	    "// Copyright (c) 2014-2015, NVIDIA CORPORATION. All rights reserved.",
	    "//",
	    "// Redistribution and use in source and binary forms, with or without",
	    "// modification, are permitted provided that the following conditions",
	    "// are met:",
	    "//  * Redistributions of source code must retain the above copyright",
	    "//    notice, this list of conditions and the following disclaimer.",
	    "//  * Redistributions in binary form must reproduce the above copyright",
	    "//    notice, this list of conditions and the following disclaimer in the",
	    "//    documentation and/or other materials provided with the distribution.",
	    "//  * Neither the name of NVIDIA CORPORATION nor the names of its",
	    "//    contributors may be used to endorse or promote products derived",
	    "//    from this software without specific prior written permission.",
	    "//",
	    "// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS'' AND ANY",
	    "// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE",
	    "// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR",
	    "// PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT OWNER OR",
	    "// CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,",
	    "// EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,",
	    "// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR",
	    "// PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY",
	    "// OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT",
	    "// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE",
	    "// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.",
	    "//",
	    "//----------------------------------------------------------------------------------",
	    "",
	    "#define FXAA_PC 1",
	    "#define FXAA_GLSL_100 1",
	    "#define FXAA_QUALITY_PRESET 12",
	    "",
	    "#define FXAA_GREEN_AS_LUMA 1",
	    "",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_PC_CONSOLE",
	    "    //",
	    "    // The console algorithm for PC is included",
	    "    // for developers targeting really low spec machines.",
	    "    // Likely better to just run FXAA_PC, and use a really low preset.",
	    "    //",
	    "    #define FXAA_PC_CONSOLE 0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_GLSL_120",
	    "    #define FXAA_GLSL_120 0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_GLSL_130",
	    "    #define FXAA_GLSL_130 0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_HLSL_3",
	    "    #define FXAA_HLSL_3 0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_HLSL_4",
	    "    #define FXAA_HLSL_4 0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_HLSL_5",
	    "    #define FXAA_HLSL_5 0",
	    "#endif",
	    "/*==========================================================================*/",
	    "#ifndef FXAA_GREEN_AS_LUMA",
	    "    //",
	    "    // For those using non-linear color,",
	    "    // and either not able to get luma in alpha, or not wanting to,",
	    "    // this enables FXAA to run using green as a proxy for luma.",
	    "    // So with this enabled, no need to pack luma in alpha.",
	    "    //",
	    "    // This will turn off AA on anything which lacks some amount of green.",
	    "    // Pure red and blue or combination of only R and B, will get no AA.",
	    "    //",
	    "    // Might want to lower the settings for both,",
	    "    //    fxaaConsoleEdgeThresholdMin",
	    "    //    fxaaQualityEdgeThresholdMin",
	    "    // In order to insure AA does not get turned off on colors",
	    "    // which contain a minor amount of green.",
	    "    //",
	    "    // 1 = On.",
	    "    // 0 = Off.",
	    "    //",
	    "    #define FXAA_GREEN_AS_LUMA 0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_EARLY_EXIT",
	    "    //",
	    "    // Controls algorithm's early exit path.",
	    "    // On PS3 turning this ON adds 2 cycles to the shader.",
	    "    // On 360 turning this OFF adds 10ths of a millisecond to the shader.",
	    "    // Turning this off on console will result in a more blurry image.",
	    "    // So this defaults to on.",
	    "    //",
	    "    // 1 = On.",
	    "    // 0 = Off.",
	    "    //",
	    "    #define FXAA_EARLY_EXIT 1",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_DISCARD",
	    "    //",
	    "    // Only valid for PC OpenGL currently.",
	    "    // Probably will not work when FXAA_GREEN_AS_LUMA = 1.",
	    "    //",
	    "    // 1 = Use discard on pixels which don't need AA.",
	    "    //     For APIs which enable concurrent TEX+ROP from same surface.",
	    "    // 0 = Return unchanged color on pixels which don't need AA.",
	    "    //",
	    "    #define FXAA_DISCARD 0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_FAST_PIXEL_OFFSET",
	    "    //",
	    "    // Used for GLSL 120 only.",
	    "    //",
	    "    // 1 = GL API supports fast pixel offsets",
	    "    // 0 = do not use fast pixel offsets",
	    "    //",
	    "    #ifdef GL_EXT_gpu_shader4",
	    "        #define FXAA_FAST_PIXEL_OFFSET 1",
	    "    #endif",
	    "    #ifdef GL_NV_gpu_shader5",
	    "        #define FXAA_FAST_PIXEL_OFFSET 1",
	    "    #endif",
	    "    #ifdef GL_ARB_gpu_shader5",
	    "        #define FXAA_FAST_PIXEL_OFFSET 1",
	    "    #endif",
	    "    #ifndef FXAA_FAST_PIXEL_OFFSET",
	    "        #define FXAA_FAST_PIXEL_OFFSET 0",
	    "    #endif",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#ifndef FXAA_GATHER4_ALPHA",
	    "    //",
	    "    // 1 = API supports gather4 on alpha channel.",
	    "    // 0 = API does not support gather4 on alpha channel.",
	    "    //",
	    "    #if (FXAA_HLSL_5 == 1)",
	    "        #define FXAA_GATHER4_ALPHA 1",
	    "    #endif",
	    "    #ifdef GL_ARB_gpu_shader5",
	    "        #define FXAA_GATHER4_ALPHA 1",
	    "    #endif",
	    "    #ifdef GL_NV_gpu_shader5",
	    "        #define FXAA_GATHER4_ALPHA 1",
	    "    #endif",
	    "    #ifndef FXAA_GATHER4_ALPHA",
	    "        #define FXAA_GATHER4_ALPHA 0",
	    "    #endif",
	    "#endif",
	    "",
	    "",
	    "/*============================================================================",
	    "                        FXAA QUALITY - TUNING KNOBS",
	    "------------------------------------------------------------------------------",
	    "NOTE the other tuning knobs are now in the shader function inputs!",
	    "============================================================================*/",
	    "#ifndef FXAA_QUALITY_PRESET",
	    "    //",
	    "    // Choose the quality preset.",
	    "    // This needs to be compiled into the shader as it effects code.",
	    "    // Best option to include multiple presets is to",
	    "    // in each shader define the preset, then include this file.",
	    "    //",
	    "    // OPTIONS",
	    "    // -----------------------------------------------------------------------",
	    "    // 10 to 15 - default medium dither (10=fastest, 15=highest quality)",
	    "    // 20 to 29 - less dither, more expensive (20=fastest, 29=highest quality)",
	    "    // 39       - no dither, very expensive",
	    "    //",
	    "    // NOTES",
	    "    // -----------------------------------------------------------------------",
	    "    // 12 = slightly faster then FXAA 3.9 and higher edge quality (default)",
	    "    // 13 = about same speed as FXAA 3.9 and better than 12",
	    "    // 23 = closest to FXAA 3.9 visually and performance wise",
	    "    //  _ = the lowest digit is directly related to performance",
	    "    // _  = the highest digit is directly related to style",
	    "    //",
	    "    #define FXAA_QUALITY_PRESET 12",
	    "#endif",
	    "",
	    "",
	    "/*============================================================================",
	    "",
	    "                           FXAA QUALITY - PRESETS",
	    "",
	    "============================================================================*/",
	    "",
	    "/*============================================================================",
	    "                     FXAA QUALITY - MEDIUM DITHER PRESETS",
	    "============================================================================*/",
	    "#if (FXAA_QUALITY_PRESET == 10)",
	    "    #define FXAA_QUALITY_PS 3",
	    "    #define FXAA_QUALITY_P0 1.5",
	    "    #define FXAA_QUALITY_P1 3.0",
	    "    #define FXAA_QUALITY_P2 12.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 11)",
	    "    #define FXAA_QUALITY_PS 4",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 3.0",
	    "    #define FXAA_QUALITY_P3 12.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 12)",
	    "    #define FXAA_QUALITY_PS 5",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 4.0",
	    "    #define FXAA_QUALITY_P4 12.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 13)",
	    "    #define FXAA_QUALITY_PS 6",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 4.0",
	    "    #define FXAA_QUALITY_P5 12.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 14)",
	    "    #define FXAA_QUALITY_PS 7",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 4.0",
	    "    #define FXAA_QUALITY_P6 12.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 15)",
	    "    #define FXAA_QUALITY_PS 8",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 2.0",
	    "    #define FXAA_QUALITY_P6 4.0",
	    "    #define FXAA_QUALITY_P7 12.0",
	    "#endif",
	    "",
	    "/*============================================================================",
	    "                     FXAA QUALITY - LOW DITHER PRESETS",
	    "============================================================================*/",
	    "#if (FXAA_QUALITY_PRESET == 20)",
	    "    #define FXAA_QUALITY_PS 3",
	    "    #define FXAA_QUALITY_P0 1.5",
	    "    #define FXAA_QUALITY_P1 2.0",
	    "    #define FXAA_QUALITY_P2 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 21)",
	    "    #define FXAA_QUALITY_PS 4",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 22)",
	    "    #define FXAA_QUALITY_PS 5",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 23)",
	    "    #define FXAA_QUALITY_PS 6",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 24)",
	    "    #define FXAA_QUALITY_PS 7",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 3.0",
	    "    #define FXAA_QUALITY_P6 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 25)",
	    "    #define FXAA_QUALITY_PS 8",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 2.0",
	    "    #define FXAA_QUALITY_P6 4.0",
	    "    #define FXAA_QUALITY_P7 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 26)",
	    "    #define FXAA_QUALITY_PS 9",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 2.0",
	    "    #define FXAA_QUALITY_P6 2.0",
	    "    #define FXAA_QUALITY_P7 4.0",
	    "    #define FXAA_QUALITY_P8 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 27)",
	    "    #define FXAA_QUALITY_PS 10",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 2.0",
	    "    #define FXAA_QUALITY_P6 2.0",
	    "    #define FXAA_QUALITY_P7 2.0",
	    "    #define FXAA_QUALITY_P8 4.0",
	    "    #define FXAA_QUALITY_P9 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 28)",
	    "    #define FXAA_QUALITY_PS 11",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 2.0",
	    "    #define FXAA_QUALITY_P6 2.0",
	    "    #define FXAA_QUALITY_P7 2.0",
	    "    #define FXAA_QUALITY_P8 2.0",
	    "    #define FXAA_QUALITY_P9 4.0",
	    "    #define FXAA_QUALITY_P10 8.0",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_QUALITY_PRESET == 29)",
	    "    #define FXAA_QUALITY_PS 12",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.5",
	    "    #define FXAA_QUALITY_P2 2.0",
	    "    #define FXAA_QUALITY_P3 2.0",
	    "    #define FXAA_QUALITY_P4 2.0",
	    "    #define FXAA_QUALITY_P5 2.0",
	    "    #define FXAA_QUALITY_P6 2.0",
	    "    #define FXAA_QUALITY_P7 2.0",
	    "    #define FXAA_QUALITY_P8 2.0",
	    "    #define FXAA_QUALITY_P9 2.0",
	    "    #define FXAA_QUALITY_P10 4.0",
	    "    #define FXAA_QUALITY_P11 8.0",
	    "#endif",
	    "",
	    "/*============================================================================",
	    "                     FXAA QUALITY - EXTREME QUALITY",
	    "============================================================================*/",
	    "#if (FXAA_QUALITY_PRESET == 39)",
	    "    #define FXAA_QUALITY_PS 12",
	    "    #define FXAA_QUALITY_P0 1.0",
	    "    #define FXAA_QUALITY_P1 1.0",
	    "    #define FXAA_QUALITY_P2 1.0",
	    "    #define FXAA_QUALITY_P3 1.0",
	    "    #define FXAA_QUALITY_P4 1.0",
	    "    #define FXAA_QUALITY_P5 1.5",
	    "    #define FXAA_QUALITY_P6 2.0",
	    "    #define FXAA_QUALITY_P7 2.0",
	    "    #define FXAA_QUALITY_P8 2.0",
	    "    #define FXAA_QUALITY_P9 2.0",
	    "    #define FXAA_QUALITY_P10 4.0",
	    "    #define FXAA_QUALITY_P11 8.0",
	    "#endif",
	    "",
	    "",
	    "",
	    "/*============================================================================",
	    "",
	    "                                API PORTING",
	    "",
	    "============================================================================*/",
	    "#if (FXAA_GLSL_100 == 1) || (FXAA_GLSL_120 == 1) || (FXAA_GLSL_130 == 1)",
	    "    #define FxaaBool bool",
	    "    #define FxaaDiscard discard",
	    "    #define FxaaFloat float",
	    "    #define FxaaFloat2 vec2",
	    "    #define FxaaFloat3 vec3",
	    "    #define FxaaFloat4 vec4",
	    "    #define FxaaHalf float",
	    "    #define FxaaHalf2 vec2",
	    "    #define FxaaHalf3 vec3",
	    "    #define FxaaHalf4 vec4",
	    "    #define FxaaInt2 ivec2",
	    "    #define FxaaSat(x) clamp(x, 0.0, 1.0)",
	    "    #define FxaaTex sampler2D",
	    "#else",
	    "    #define FxaaBool bool",
	    "    #define FxaaDiscard clip(-1)",
	    "    #define FxaaFloat float",
	    "    #define FxaaFloat2 float2",
	    "    #define FxaaFloat3 float3",
	    "    #define FxaaFloat4 float4",
	    "    #define FxaaHalf half",
	    "    #define FxaaHalf2 half2",
	    "    #define FxaaHalf3 half3",
	    "    #define FxaaHalf4 half4",
	    "    #define FxaaSat(x) saturate(x)",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_GLSL_100 == 1)",
	    "  #define FxaaTexTop(t, p) texture2D(t, p, 0.0)",
	    "  #define FxaaTexOff(t, p, o, r) texture2D(t, p + (o * r), 0.0)",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_GLSL_120 == 1)",
	    "    // Requires,",
	    "    //  #version 120",
	    "    // And at least,",
	    "    //  #extension GL_EXT_gpu_shader4 : enable",
	    "    //  (or set FXAA_FAST_PIXEL_OFFSET 1 to work like DX9)",
	    "    #define FxaaTexTop(t, p) texture2DLod(t, p, 0.0)",
	    "    #if (FXAA_FAST_PIXEL_OFFSET == 1)",
	    "        #define FxaaTexOff(t, p, o, r) texture2DLodOffset(t, p, 0.0, o)",
	    "    #else",
	    "        #define FxaaTexOff(t, p, o, r) texture2DLod(t, p + (o * r), 0.0)",
	    "    #endif",
	    "    #if (FXAA_GATHER4_ALPHA == 1)",
	    "        // use #extension GL_ARB_gpu_shader5 : enable",
	    "        #define FxaaTexAlpha4(t, p) textureGather(t, p, 3)",
	    "        #define FxaaTexOffAlpha4(t, p, o) textureGatherOffset(t, p, o, 3)",
	    "        #define FxaaTexGreen4(t, p) textureGather(t, p, 1)",
	    "        #define FxaaTexOffGreen4(t, p, o) textureGatherOffset(t, p, o, 1)",
	    "    #endif",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_GLSL_130 == 1)",
	    "    // Requires \"#version 130\" or better",
	    "    #define FxaaTexTop(t, p) textureLod(t, p, 0.0)",
	    "    #define FxaaTexOff(t, p, o, r) textureLodOffset(t, p, 0.0, o)",
	    "    #if (FXAA_GATHER4_ALPHA == 1)",
	    "        // use #extension GL_ARB_gpu_shader5 : enable",
	    "        #define FxaaTexAlpha4(t, p) textureGather(t, p, 3)",
	    "        #define FxaaTexOffAlpha4(t, p, o) textureGatherOffset(t, p, o, 3)",
	    "        #define FxaaTexGreen4(t, p) textureGather(t, p, 1)",
	    "        #define FxaaTexOffGreen4(t, p, o) textureGatherOffset(t, p, o, 1)",
	    "    #endif",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_HLSL_3 == 1)",
	    "    #define FxaaInt2 float2",
	    "    #define FxaaTex sampler2D",
	    "    #define FxaaTexTop(t, p) tex2Dlod(t, float4(p, 0.0, 0.0))",
	    "    #define FxaaTexOff(t, p, o, r) tex2Dlod(t, float4(p + (o * r), 0, 0))",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_HLSL_4 == 1)",
	    "    #define FxaaInt2 int2",
	    "    struct FxaaTex { SamplerState smpl; Texture2D tex; };",
	    "    #define FxaaTexTop(t, p) t.tex.SampleLevel(t.smpl, p, 0.0)",
	    "    #define FxaaTexOff(t, p, o, r) t.tex.SampleLevel(t.smpl, p, 0.0, o)",
	    "#endif",
	    "/*--------------------------------------------------------------------------*/",
	    "#if (FXAA_HLSL_5 == 1)",
	    "    #define FxaaInt2 int2",
	    "    struct FxaaTex { SamplerState smpl; Texture2D tex; };",
	    "    #define FxaaTexTop(t, p) t.tex.SampleLevel(t.smpl, p, 0.0)",
	    "    #define FxaaTexOff(t, p, o, r) t.tex.SampleLevel(t.smpl, p, 0.0, o)",
	    "    #define FxaaTexAlpha4(t, p) t.tex.GatherAlpha(t.smpl, p)",
	    "    #define FxaaTexOffAlpha4(t, p, o) t.tex.GatherAlpha(t.smpl, p, o)",
	    "    #define FxaaTexGreen4(t, p) t.tex.GatherGreen(t.smpl, p)",
	    "    #define FxaaTexOffGreen4(t, p, o) t.tex.GatherGreen(t.smpl, p, o)",
	    "#endif",
	    "",
	    "",
	    "/*============================================================================",
	    "                   GREEN AS LUMA OPTION SUPPORT FUNCTION",
	    "============================================================================*/",
	    "#if (FXAA_GREEN_AS_LUMA == 0)",
	    "    FxaaFloat FxaaLuma(FxaaFloat4 rgba) { return rgba.w; }",
	    "#else",
	    "    FxaaFloat FxaaLuma(FxaaFloat4 rgba) { return rgba.y; }",
	    "#endif",
	    "",
	    "",
	    "",
	    "",
	    "/*============================================================================",
	    "",
	    "                             FXAA3 QUALITY - PC",
	    "",
	    "============================================================================*/",
	    "#if (FXAA_PC == 1)",
	    "/*--------------------------------------------------------------------------*/",
	    "FxaaFloat4 FxaaPixelShader(",
	    "    //",
	    "    // Use noperspective interpolation here (turn off perspective interpolation).",
	    "    // {xy} = center of pixel",
	    "    FxaaFloat2 pos,",
	    "    //",
	    "    // Used only for FXAA Console, and not used on the 360 version.",
	    "    // Use noperspective interpolation here (turn off perspective interpolation).",
	    "    // {xy_} = upper left of pixel",
	    "    // {_zw} = lower right of pixel",
	    "    FxaaFloat4 fxaaConsolePosPos,",
	    "    //",
	    "    // Input color texture.",
	    "    // {rgb_} = color in linear or perceptual color space",
	    "    // if (FXAA_GREEN_AS_LUMA == 0)",
	    "    //     {__a} = luma in perceptual color space (not linear)",
	    "    FxaaTex tex,",
	    "    //",
	    "    // Only used on the optimized 360 version of FXAA Console.",
	    "    // For everything but 360, just use the same input here as for \"tex\".",
	    "    // For 360, same texture, just alias with a 2nd sampler.",
	    "    // This sampler needs to have an exponent bias of -1.",
	    "    FxaaTex fxaaConsole360TexExpBiasNegOne,",
	    "    //",
	    "    // Only used on the optimized 360 version of FXAA Console.",
	    "    // For everything but 360, just use the same input here as for \"tex\".",
	    "    // For 360, same texture, just alias with a 3nd sampler.",
	    "    // This sampler needs to have an exponent bias of -2.",
	    "    FxaaTex fxaaConsole360TexExpBiasNegTwo,",
	    "    //",
	    "    // Only used on FXAA Quality.",
	    "    // This must be from a constant/uniform.",
	    "    // {x_} = 1.0/screenWidthInPixels",
	    "    // {_y} = 1.0/screenHeightInPixels",
	    "    FxaaFloat2 fxaaQualityRcpFrame,",
	    "    //",
	    "    // Only used on FXAA Console.",
	    "    // This must be from a constant/uniform.",
	    "    // This effects sub-pixel AA quality and inversely sharpness.",
	    "    //   Where N ranges between,",
	    "    //     N = 0.50 (default)",
	    "    //     N = 0.33 (sharper)",
	    "    // {x__} = -N/screenWidthInPixels",
	    "    // {_y_} = -N/screenHeightInPixels",
	    "    // {_z_} =  N/screenWidthInPixels",
	    "    // {__w} =  N/screenHeightInPixels",
	    "    FxaaFloat4 fxaaConsoleRcpFrameOpt,",
	    "    //",
	    "    // Only used on FXAA Console.",
	    "    // Not used on 360, but used on PS3 and PC.",
	    "    // This must be from a constant/uniform.",
	    "    // {x__} = -2.0/screenWidthInPixels",
	    "    // {_y_} = -2.0/screenHeightInPixels",
	    "    // {_z_} =  2.0/screenWidthInPixels",
	    "    // {__w} =  2.0/screenHeightInPixels",
	    "    FxaaFloat4 fxaaConsoleRcpFrameOpt2,",
	    "    //",
	    "    // Only used on FXAA Console.",
	    "    // Only used on 360 in place of fxaaConsoleRcpFrameOpt2.",
	    "    // This must be from a constant/uniform.",
	    "    // {x__} =  8.0/screenWidthInPixels",
	    "    // {_y_} =  8.0/screenHeightInPixels",
	    "    // {_z_} = -4.0/screenWidthInPixels",
	    "    // {__w} = -4.0/screenHeightInPixels",
	    "    FxaaFloat4 fxaaConsole360RcpFrameOpt2,",
	    "    //",
	    "    // Only used on FXAA Quality.",
	    "    // This used to be the FXAA_QUALITY_SUBPIX define.",
	    "    // It is here now to allow easier tuning.",
	    "    // Choose the amount of sub-pixel aliasing removal.",
	    "    // This can effect sharpness.",
	    "    //   1.00 - upper limit (softer)",
	    "    //   0.75 - default amount of filtering",
	    "    //   0.50 - lower limit (sharper, less sub-pixel aliasing removal)",
	    "    //   0.25 - almost off",
	    "    //   0.00 - completely off",
	    "    FxaaFloat fxaaQualitySubpix,",
	    "    //",
	    "    // Only used on FXAA Quality.",
	    "    // This used to be the FXAA_QUALITY_EDGE_THRESHOLD define.",
	    "    // It is here now to allow easier tuning.",
	    "    // The minimum amount of local contrast required to apply algorithm.",
	    "    //   0.333 - too little (faster)",
	    "    //   0.250 - low quality",
	    "    //   0.166 - default",
	    "    //   0.125 - high quality",
	    "    //   0.063 - overkill (slower)",
	    "    FxaaFloat fxaaQualityEdgeThreshold,",
	    "    //",
	    "    // Only used on FXAA Quality.",
	    "    // This used to be the FXAA_QUALITY_EDGE_THRESHOLD_MIN define.",
	    "    // It is here now to allow easier tuning.",
	    "    // Trims the algorithm from processing darks.",
	    "    //   0.0833 - upper limit (default, the start of visible unfiltered edges)",
	    "    //   0.0625 - high quality (faster)",
	    "    //   0.0312 - visible limit (slower)",
	    "    // Special notes when using FXAA_GREEN_AS_LUMA,",
	    "    //   Likely want to set this to zero.",
	    "    //   As colors that are mostly not-green",
	    "    //   will appear very dark in the green channel!",
	    "    //   Tune by looking at mostly non-green content,",
	    "    //   then start at zero and increase until aliasing is a problem.",
	    "    FxaaFloat fxaaQualityEdgeThresholdMin,",
	    "    //",
	    "    // Only used on FXAA Console.",
	    "    // This used to be the FXAA_CONSOLE_EDGE_SHARPNESS define.",
	    "    // It is here now to allow easier tuning.",
	    "    // This does not effect PS3, as this needs to be compiled in.",
	    "    //   Use FXAA_CONSOLE_PS3_EDGE_SHARPNESS for PS3.",
	    "    //   Due to the PS3 being ALU bound,",
	    "    //   there are only three safe values here: 2 and 4 and 8.",
	    "    //   These options use the shaders ability to a free *|/ by 2|4|8.",
	    "    // For all other platforms can be a non-power of two.",
	    "    //   8.0 is sharper (default!!!)",
	    "    //   4.0 is softer",
	    "    //   2.0 is really soft (good only for vector graphics inputs)",
	    "    FxaaFloat fxaaConsoleEdgeSharpness,",
	    "    //",
	    "    // Only used on FXAA Console.",
	    "    // This used to be the FXAA_CONSOLE_EDGE_THRESHOLD define.",
	    "    // It is here now to allow easier tuning.",
	    "    // This does not effect PS3, as this needs to be compiled in.",
	    "    //   Use FXAA_CONSOLE_PS3_EDGE_THRESHOLD for PS3.",
	    "    //   Due to the PS3 being ALU bound,",
	    "    //   there are only two safe values here: 1/4 and 1/8.",
	    "    //   These options use the shaders ability to a free *|/ by 2|4|8.",
	    "    // The console setting has a different mapping than the quality setting.",
	    "    // Other platforms can use other values.",
	    "    //   0.125 leaves less aliasing, but is softer (default!!!)",
	    "    //   0.25 leaves more aliasing, and is sharper",
	    "    FxaaFloat fxaaConsoleEdgeThreshold,",
	    "    //",
	    "    // Only used on FXAA Console.",
	    "    // This used to be the FXAA_CONSOLE_EDGE_THRESHOLD_MIN define.",
	    "    // It is here now to allow easier tuning.",
	    "    // Trims the algorithm from processing darks.",
	    "    // The console setting has a different mapping than the quality setting.",
	    "    // This only applies when FXAA_EARLY_EXIT is 1.",
	    "    // This does not apply to PS3,",
	    "    // PS3 was simplified to avoid more shader instructions.",
	    "    //   0.06 - faster but more aliasing in darks",
	    "    //   0.05 - default",
	    "    //   0.04 - slower and less aliasing in darks",
	    "    // Special notes when using FXAA_GREEN_AS_LUMA,",
	    "    //   Likely want to set this to zero.",
	    "    //   As colors that are mostly not-green",
	    "    //   will appear very dark in the green channel!",
	    "    //   Tune by looking at mostly non-green content,",
	    "    //   then start at zero and increase until aliasing is a problem.",
	    "    FxaaFloat fxaaConsoleEdgeThresholdMin,",
	    "    //",
	    "    // Extra constants for 360 FXAA Console only.",
	    "    // Use zeros or anything else for other platforms.",
	    "    // These must be in physical constant registers and NOT immedates.",
	    "    // Immedates will result in compiler un-optimizing.",
	    "    // {xyzw} = float4(1.0, -1.0, 0.25, -0.25)",
	    "    FxaaFloat4 fxaaConsole360ConstDir",
	    ") {",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat2 posM;",
	    "    posM.x = pos.x;",
	    "    posM.y = pos.y;",
	    "    #if (FXAA_GATHER4_ALPHA == 1)",
	    "        #if (FXAA_DISCARD == 0)",
	    "            FxaaFloat4 rgbyM = FxaaTexTop(tex, posM);",
	    "            #if (FXAA_GREEN_AS_LUMA == 0)",
	    "                #define lumaM rgbyM.w",
	    "            #else",
	    "                #define lumaM rgbyM.y",
	    "            #endif",
	    "        #endif",
	    "        #if (FXAA_GREEN_AS_LUMA == 0)",
	    "            FxaaFloat4 luma4A = FxaaTexAlpha4(tex, posM);",
	    "            FxaaFloat4 luma4B = FxaaTexOffAlpha4(tex, posM, FxaaInt2(-1, -1));",
	    "        #else",
	    "            FxaaFloat4 luma4A = FxaaTexGreen4(tex, posM);",
	    "            FxaaFloat4 luma4B = FxaaTexOffGreen4(tex, posM, FxaaInt2(-1, -1));",
	    "        #endif",
	    "        #if (FXAA_DISCARD == 1)",
	    "            #define lumaM luma4A.w",
	    "        #endif",
	    "        #define lumaE luma4A.z",
	    "        #define lumaS luma4A.x",
	    "        #define lumaSE luma4A.y",
	    "        #define lumaNW luma4B.w",
	    "        #define lumaN luma4B.z",
	    "        #define lumaW luma4B.x",
	    "    #else",
	    "        FxaaFloat4 rgbyM = FxaaTexTop(tex, posM);",
	    "        #if (FXAA_GREEN_AS_LUMA == 0)",
	    "            #define lumaM rgbyM.w",
	    "        #else",
	    "            #define lumaM rgbyM.y",
	    "        #endif",
	    "        #if (FXAA_GLSL_100 == 1)",
	    "          FxaaFloat lumaS = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 0.0, 1.0), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0, 0.0), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaN = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 0.0,-1.0), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0, 0.0), fxaaQualityRcpFrame.xy));",
	    "        #else",
	    "          FxaaFloat lumaS = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 0, 1), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1, 0), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaN = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 0,-1), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 0), fxaaQualityRcpFrame.xy));",
	    "        #endif",
	    "    #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat maxSM = max(lumaS, lumaM);",
	    "    FxaaFloat minSM = min(lumaS, lumaM);",
	    "    FxaaFloat maxESM = max(lumaE, maxSM);",
	    "    FxaaFloat minESM = min(lumaE, minSM);",
	    "    FxaaFloat maxWN = max(lumaN, lumaW);",
	    "    FxaaFloat minWN = min(lumaN, lumaW);",
	    "    FxaaFloat rangeMax = max(maxWN, maxESM);",
	    "    FxaaFloat rangeMin = min(minWN, minESM);",
	    "    FxaaFloat rangeMaxScaled = rangeMax * fxaaQualityEdgeThreshold;",
	    "    FxaaFloat range = rangeMax - rangeMin;",
	    "    FxaaFloat rangeMaxClamped = max(fxaaQualityEdgeThresholdMin, rangeMaxScaled);",
	    "    FxaaBool earlyExit = range < rangeMaxClamped;",
	    "/*--------------------------------------------------------------------------*/",
	    "    if(earlyExit)",
	    "        #if (FXAA_DISCARD == 1)",
	    "            FxaaDiscard;",
	    "        #else",
	    "            return rgbyM;",
	    "        #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "    #if (FXAA_GATHER4_ALPHA == 0)",
	    "        #if (FXAA_GLSL_100 == 1)",
	    "          FxaaFloat lumaNW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0,-1.0), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaSE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0, 1.0), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2( 1.0,-1.0), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaFloat2(-1.0, 1.0), fxaaQualityRcpFrame.xy));",
	    "        #else",
	    "          FxaaFloat lumaNW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1,-1), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaSE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1, 1), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2( 1,-1), fxaaQualityRcpFrame.xy));",
	    "          FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 1), fxaaQualityRcpFrame.xy));",
	    "        #endif",
	    "    #else",
	    "        FxaaFloat lumaNE = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(1, -1), fxaaQualityRcpFrame.xy));",
	    "        FxaaFloat lumaSW = FxaaLuma(FxaaTexOff(tex, posM, FxaaInt2(-1, 1), fxaaQualityRcpFrame.xy));",
	    "    #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat lumaNS = lumaN + lumaS;",
	    "    FxaaFloat lumaWE = lumaW + lumaE;",
	    "    FxaaFloat subpixRcpRange = 1.0/range;",
	    "    FxaaFloat subpixNSWE = lumaNS + lumaWE;",
	    "    FxaaFloat edgeHorz1 = (-2.0 * lumaM) + lumaNS;",
	    "    FxaaFloat edgeVert1 = (-2.0 * lumaM) + lumaWE;",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat lumaNESE = lumaNE + lumaSE;",
	    "    FxaaFloat lumaNWNE = lumaNW + lumaNE;",
	    "    FxaaFloat edgeHorz2 = (-2.0 * lumaE) + lumaNESE;",
	    "    FxaaFloat edgeVert2 = (-2.0 * lumaN) + lumaNWNE;",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat lumaNWSW = lumaNW + lumaSW;",
	    "    FxaaFloat lumaSWSE = lumaSW + lumaSE;",
	    "    FxaaFloat edgeHorz4 = (abs(edgeHorz1) * 2.0) + abs(edgeHorz2);",
	    "    FxaaFloat edgeVert4 = (abs(edgeVert1) * 2.0) + abs(edgeVert2);",
	    "    FxaaFloat edgeHorz3 = (-2.0 * lumaW) + lumaNWSW;",
	    "    FxaaFloat edgeVert3 = (-2.0 * lumaS) + lumaSWSE;",
	    "    FxaaFloat edgeHorz = abs(edgeHorz3) + edgeHorz4;",
	    "    FxaaFloat edgeVert = abs(edgeVert3) + edgeVert4;",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat subpixNWSWNESE = lumaNWSW + lumaNESE;",
	    "    FxaaFloat lengthSign = fxaaQualityRcpFrame.x;",
	    "    FxaaBool horzSpan = edgeHorz >= edgeVert;",
	    "    FxaaFloat subpixA = subpixNSWE * 2.0 + subpixNWSWNESE;",
	    "/*--------------------------------------------------------------------------*/",
	    "    if(!horzSpan) lumaN = lumaW;",
	    "    if(!horzSpan) lumaS = lumaE;",
	    "    if(horzSpan) lengthSign = fxaaQualityRcpFrame.y;",
	    "    FxaaFloat subpixB = (subpixA * (1.0/12.0)) - lumaM;",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat gradientN = lumaN - lumaM;",
	    "    FxaaFloat gradientS = lumaS - lumaM;",
	    "    FxaaFloat lumaNN = lumaN + lumaM;",
	    "    FxaaFloat lumaSS = lumaS + lumaM;",
	    "    FxaaBool pairN = abs(gradientN) >= abs(gradientS);",
	    "    FxaaFloat gradient = max(abs(gradientN), abs(gradientS));",
	    "    if(pairN) lengthSign = -lengthSign;",
	    "    FxaaFloat subpixC = FxaaSat(abs(subpixB) * subpixRcpRange);",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat2 posB;",
	    "    posB.x = posM.x;",
	    "    posB.y = posM.y;",
	    "    FxaaFloat2 offNP;",
	    "    offNP.x = (!horzSpan) ? 0.0 : fxaaQualityRcpFrame.x;",
	    "    offNP.y = ( horzSpan) ? 0.0 : fxaaQualityRcpFrame.y;",
	    "    if(!horzSpan) posB.x += lengthSign * 0.5;",
	    "    if( horzSpan) posB.y += lengthSign * 0.5;",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat2 posN;",
	    "    posN.x = posB.x - offNP.x * FXAA_QUALITY_P0;",
	    "    posN.y = posB.y - offNP.y * FXAA_QUALITY_P0;",
	    "    FxaaFloat2 posP;",
	    "    posP.x = posB.x + offNP.x * FXAA_QUALITY_P0;",
	    "    posP.y = posB.y + offNP.y * FXAA_QUALITY_P0;",
	    "    FxaaFloat subpixD = ((-2.0)*subpixC) + 3.0;",
	    "    FxaaFloat lumaEndN = FxaaLuma(FxaaTexTop(tex, posN));",
	    "    FxaaFloat subpixE = subpixC * subpixC;",
	    "    FxaaFloat lumaEndP = FxaaLuma(FxaaTexTop(tex, posP));",
	    "/*--------------------------------------------------------------------------*/",
	    "    if(!pairN) lumaNN = lumaSS;",
	    "    FxaaFloat gradientScaled = gradient * 1.0/4.0;",
	    "    FxaaFloat lumaMM = lumaM - lumaNN * 0.5;",
	    "    FxaaFloat subpixF = subpixD * subpixE;",
	    "    FxaaBool lumaMLTZero = lumaMM < 0.0;",
	    "/*--------------------------------------------------------------------------*/",
	    "    lumaEndN -= lumaNN * 0.5;",
	    "    lumaEndP -= lumaNN * 0.5;",
	    "    FxaaBool doneN = abs(lumaEndN) >= gradientScaled;",
	    "    FxaaBool doneP = abs(lumaEndP) >= gradientScaled;",
	    "    if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P1;",
	    "    if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P1;",
	    "    FxaaBool doneNP = (!doneN) || (!doneP);",
	    "    if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P1;",
	    "    if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P1;",
	    "/*--------------------------------------------------------------------------*/",
	    "    if(doneNP) {",
	    "        if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "        if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "        if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "        if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "        doneN = abs(lumaEndN) >= gradientScaled;",
	    "        doneP = abs(lumaEndP) >= gradientScaled;",
	    "        if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P2;",
	    "        if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P2;",
	    "        doneNP = (!doneN) || (!doneP);",
	    "        if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P2;",
	    "        if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P2;",
	    "/*--------------------------------------------------------------------------*/",
	    "        #if (FXAA_QUALITY_PS > 3)",
	    "        if(doneNP) {",
	    "            if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "            if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "            if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "            if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "            doneN = abs(lumaEndN) >= gradientScaled;",
	    "            doneP = abs(lumaEndP) >= gradientScaled;",
	    "            if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P3;",
	    "            if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P3;",
	    "            doneNP = (!doneN) || (!doneP);",
	    "            if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P3;",
	    "            if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P3;",
	    "/*--------------------------------------------------------------------------*/",
	    "            #if (FXAA_QUALITY_PS > 4)",
	    "            if(doneNP) {",
	    "                if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "                if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "                if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "                if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "                doneN = abs(lumaEndN) >= gradientScaled;",
	    "                doneP = abs(lumaEndP) >= gradientScaled;",
	    "                if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P4;",
	    "                if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P4;",
	    "                doneNP = (!doneN) || (!doneP);",
	    "                if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P4;",
	    "                if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P4;",
	    "/*--------------------------------------------------------------------------*/",
	    "                #if (FXAA_QUALITY_PS > 5)",
	    "                if(doneNP) {",
	    "                    if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "                    if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "                    if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "                    if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "                    doneN = abs(lumaEndN) >= gradientScaled;",
	    "                    doneP = abs(lumaEndP) >= gradientScaled;",
	    "                    if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P5;",
	    "                    if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P5;",
	    "                    doneNP = (!doneN) || (!doneP);",
	    "                    if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P5;",
	    "                    if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P5;",
	    "/*--------------------------------------------------------------------------*/",
	    "                    #if (FXAA_QUALITY_PS > 6)",
	    "                    if(doneNP) {",
	    "                        if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "                        if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "                        if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "                        if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "                        doneN = abs(lumaEndN) >= gradientScaled;",
	    "                        doneP = abs(lumaEndP) >= gradientScaled;",
	    "                        if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P6;",
	    "                        if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P6;",
	    "                        doneNP = (!doneN) || (!doneP);",
	    "                        if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P6;",
	    "                        if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P6;",
	    "/*--------------------------------------------------------------------------*/",
	    "                        #if (FXAA_QUALITY_PS > 7)",
	    "                        if(doneNP) {",
	    "                            if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "                            if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "                            if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "                            if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "                            doneN = abs(lumaEndN) >= gradientScaled;",
	    "                            doneP = abs(lumaEndP) >= gradientScaled;",
	    "                            if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P7;",
	    "                            if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P7;",
	    "                            doneNP = (!doneN) || (!doneP);",
	    "                            if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P7;",
	    "                            if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P7;",
	    "/*--------------------------------------------------------------------------*/",
	    "    #if (FXAA_QUALITY_PS > 8)",
	    "    if(doneNP) {",
	    "        if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "        if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "        if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "        if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "        doneN = abs(lumaEndN) >= gradientScaled;",
	    "        doneP = abs(lumaEndP) >= gradientScaled;",
	    "        if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P8;",
	    "        if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P8;",
	    "        doneNP = (!doneN) || (!doneP);",
	    "        if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P8;",
	    "        if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P8;",
	    "/*--------------------------------------------------------------------------*/",
	    "        #if (FXAA_QUALITY_PS > 9)",
	    "        if(doneNP) {",
	    "            if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "            if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "            if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "            if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "            doneN = abs(lumaEndN) >= gradientScaled;",
	    "            doneP = abs(lumaEndP) >= gradientScaled;",
	    "            if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P9;",
	    "            if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P9;",
	    "            doneNP = (!doneN) || (!doneP);",
	    "            if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P9;",
	    "            if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P9;",
	    "/*--------------------------------------------------------------------------*/",
	    "            #if (FXAA_QUALITY_PS > 10)",
	    "            if(doneNP) {",
	    "                if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "                if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "                if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "                if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "                doneN = abs(lumaEndN) >= gradientScaled;",
	    "                doneP = abs(lumaEndP) >= gradientScaled;",
	    "                if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P10;",
	    "                if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P10;",
	    "                doneNP = (!doneN) || (!doneP);",
	    "                if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P10;",
	    "                if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P10;",
	    "/*--------------------------------------------------------------------------*/",
	    "                #if (FXAA_QUALITY_PS > 11)",
	    "                if(doneNP) {",
	    "                    if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "                    if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "                    if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "                    if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "                    doneN = abs(lumaEndN) >= gradientScaled;",
	    "                    doneP = abs(lumaEndP) >= gradientScaled;",
	    "                    if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P11;",
	    "                    if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P11;",
	    "                    doneNP = (!doneN) || (!doneP);",
	    "                    if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P11;",
	    "                    if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P11;",
	    "/*--------------------------------------------------------------------------*/",
	    "                    #if (FXAA_QUALITY_PS > 12)",
	    "                    if(doneNP) {",
	    "                        if(!doneN) lumaEndN = FxaaLuma(FxaaTexTop(tex, posN.xy));",
	    "                        if(!doneP) lumaEndP = FxaaLuma(FxaaTexTop(tex, posP.xy));",
	    "                        if(!doneN) lumaEndN = lumaEndN - lumaNN * 0.5;",
	    "                        if(!doneP) lumaEndP = lumaEndP - lumaNN * 0.5;",
	    "                        doneN = abs(lumaEndN) >= gradientScaled;",
	    "                        doneP = abs(lumaEndP) >= gradientScaled;",
	    "                        if(!doneN) posN.x -= offNP.x * FXAA_QUALITY_P12;",
	    "                        if(!doneN) posN.y -= offNP.y * FXAA_QUALITY_P12;",
	    "                        doneNP = (!doneN) || (!doneP);",
	    "                        if(!doneP) posP.x += offNP.x * FXAA_QUALITY_P12;",
	    "                        if(!doneP) posP.y += offNP.y * FXAA_QUALITY_P12;",
	    "/*--------------------------------------------------------------------------*/",
	    "                    }",
	    "                    #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "                }",
	    "                #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "            }",
	    "            #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "        }",
	    "        #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "    }",
	    "    #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "                        }",
	    "                        #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "                    }",
	    "                    #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "                }",
	    "                #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "            }",
	    "            #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "        }",
	    "        #endif",
	    "/*--------------------------------------------------------------------------*/",
	    "    }",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat dstN = posM.x - posN.x;",
	    "    FxaaFloat dstP = posP.x - posM.x;",
	    "    if(!horzSpan) dstN = posM.y - posN.y;",
	    "    if(!horzSpan) dstP = posP.y - posM.y;",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaBool goodSpanN = (lumaEndN < 0.0) != lumaMLTZero;",
	    "    FxaaFloat spanLength = (dstP + dstN);",
	    "    FxaaBool goodSpanP = (lumaEndP < 0.0) != lumaMLTZero;",
	    "    FxaaFloat spanLengthRcp = 1.0/spanLength;",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaBool directionN = dstN < dstP;",
	    "    FxaaFloat dst = min(dstN, dstP);",
	    "    FxaaBool goodSpan = directionN ? goodSpanN : goodSpanP;",
	    "    FxaaFloat subpixG = subpixF * subpixF;",
	    "    FxaaFloat pixelOffset = (dst * (-spanLengthRcp)) + 0.5;",
	    "    FxaaFloat subpixH = subpixG * fxaaQualitySubpix;",
	    "/*--------------------------------------------------------------------------*/",
	    "    FxaaFloat pixelOffsetGood = goodSpan ? pixelOffset : 0.0;",
	    "    FxaaFloat pixelOffsetSubpix = max(pixelOffsetGood, subpixH);",
	    "    if(!horzSpan) posM.x += pixelOffsetSubpix * lengthSign;",
	    "    if( horzSpan) posM.y += pixelOffsetSubpix * lengthSign;",
	    "    #if (FXAA_DISCARD == 1)",
	    "        return FxaaTexTop(tex, posM);",
	    "    #else",
	    "        return FxaaFloat4(FxaaTexTop(tex, posM).xyz, lumaM);",
	    "    #endif",
	    "}",
	    "/*==========================================================================*/",
	    "#endif",
	    "",
	    "void main() {",
	    "  gl_FragColor = FxaaPixelShader(",
	    "    vUv,",
	    "    vec4(0.0),",
	    "    tDiffuse,",
	    "    tDiffuse,",
	    "    tDiffuse,",
	    "    resolution,",
	    "    vec4(0.0),",
	    "    vec4(0.0),",
	    "    vec4(0.0),",
	    "    0.75,",
	    "    0.166,",
	    "    0.0833,",
	    "    0.0,",
	    "    0.0,",
	    "    0.0,",
	    "    vec4(0.0)",
	    "  );",
	    "",
	    "  // TODO avoid querying texture twice for same texel",
	    "  gl_FragColor.a = texture2D(tDiffuse, vUv).a;",
	    "}"
	  ].join("\n")
	};

	let _extends = ( des, src, over ) => {
	  let res = _extend( des, src, over );

	  function _extend( des, src, over ) {
	    let override = true;
	    if( over === false ) {
	      override = false;
	    }
	    if( src instanceof Array ) {
	      for( let i = 0, len = src.length; i < len; i++ )
	        _extend( des, src[ i ], override );
	    }
	    for( let i in src ) {
	      if( override || !( i in des ) ) {
	        des[ i ] = src[ i ];
	      }
	    }
	    return des;
	  }
	  for( let i in src ) {
	    delete res[ i ];
	  }
	  return res;
	};

	let rndInt = ( max ) => {
	  return Math.floor( Math.random() * max );
	};

	let rndString = ( len ) => {
	  if( len <= 0 ) {
	    return '';
	  }
	  len = len - 1 || 31;
	  let $chars =
	    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	  let maxPos = $chars.length + 1;
	  let pwd = $chars.charAt( Math.floor( Math.random() * ( maxPos - 10 ) ) );
	  for( let i = 0; i < len; i++ ) {
	    pwd += $chars.charAt( Math.floor( Math.random() * maxPos ) );
	  }
	  return pwd;
	};

	let Util = {
	  extend: _extends,
	  rndInt,
	  rndString
	};

	/* eslint-disable */


	//export * from './thirdparty/three.module.js';

	exports.DefaultSettings = DefaultSettings;
	exports.App = App;
	exports.LoopManager = LoopManager;
	exports.Monitor = Monitor;
	exports.Transitioner = Transitioner;
	exports.View = View;
	exports.VR = VR;
	exports.World = World;
	exports.NotFunctionError = NotFunctionError$1;
	exports.EventManager = EventManager;
	exports.Events = Events;
	exports.Signal = Signal;
	exports.GUI = GUI;
	exports.Body = Body;
	exports.Txt = Txt;
	exports.Div = Div;
	exports.LoaderFactory = LoaderFactory;
	exports.EffectComposer = EffectComposer;
	exports.Pass = Pass;
	exports.DotScreenPass = DotScreenPass;
	exports.RenderPass = RenderPass;
	exports.ShaderPass = ShaderPass;
	exports.GlitchPass = GlitchPass;
	exports.GlitchShader = GlitchShader;
	exports.FXAAShader = FXAAShader;
	exports.CopyShader = CopyShader;
	exports.DotScreenShader = DotScreenShader;
	exports.Util = Util;

	Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=nova.js.map
