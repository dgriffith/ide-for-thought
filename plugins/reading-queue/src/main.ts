/**
 * The Reading Queue plugin's view (#2640): a global view in the left
 * sidebar, drawn from the query it declares (`public/queue.rq`).
 */
import { mount } from 'svelte';
import './base.css';
import { connect } from '/@minerva/plugin-api.js';
import App from './App.svelte';

const target = document.getElementById('app');
if (target) {
  void connect().then((minerva) => mount(App, { target, props: { minerva } }));
}
