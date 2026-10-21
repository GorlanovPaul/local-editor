import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import Home from './views/Home.vue'
import './style.css'
const router = createRouter({
  history: createWebHashHistory(), // hash mode: GitHub Pages + future Telegram Mini App
  routes: [
    { path: '/', component: Home },
    { path: '/edit/:scenario?', component: () => import('./views/Editor.vue') },
    { path: '/pack', component: () => import('./views/StickerPack.vue') },
    { path: '/settings', component: () => import('./views/Settings.vue') },
    { path: '/collage', component: () => import('./views/Collage.vue') },
    { path: '/convert', component: () => import('./views/Convert.vue') },
    { path: '/:p(.*)*', redirect: '/' },
  ],
})
createApp(App).use(router).mount('#app')
