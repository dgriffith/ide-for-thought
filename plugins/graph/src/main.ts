/**
 * The Graph plugin's view (#2960): a type or query view's notes as a graph,
 * the layout Minerva's views show as Graph, drawn in a plugin frame on the
 * plugin API.
 */
import { mount } from 'svelte';
import './base.css';
import { connect } from '/@minerva/plugin-api.js';
import App from './App.svelte';

const target = document.getElementById('app');
if (target) {
  void connect().then((minerva) => mount(App, { target, props: { minerva } }));
}
