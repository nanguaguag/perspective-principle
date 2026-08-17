/* =========================================================
 * main.js — 入口与主循环
 * ========================================================= */
PP.Main = {
  running: false,
};

PP.Main.init = function () {
  const canvas = document.getElementById('scene');
  PP.Renderer.init(canvas);
  PP.Interaction.bindEvents(canvas);
  PP.resetScene();       // 先建初始场景
  PP.UI.bind();          // 再绑定 UI（此时初始立方体已被选中）
  this.resize();
  window.addEventListener('resize', () => this.resize());
  this.loop();
};

PP.Main.resize = function () {
  const canvas = document.getElementById('scene');
  PP.Renderer.resize(canvas);
};

PP.Main.loop = function () {
  this.running = true;
  const frame = () => {
    PP.Renderer.render();
    PP.UI.updateStatus();
    if (this.running) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

// 启动
window.addEventListener('DOMContentLoaded', () => {
  PP.Main.init();
});
