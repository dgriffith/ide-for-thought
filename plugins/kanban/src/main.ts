/**
 * The Kanban plugin's view (#2828): the board Minerva's type views show as
 * their Kanban layout, drawn in a plugin frame on the plugin API.
 */
import { mount } from 'svelte';
import './base.css';
import { connect } from '/@minerva/plugin-api.js';
import App from './App.svelte';

const target = document.getElementById('app');
if (target) {
  void connect().then((minerva) => mount(App, { target, props: { minerva } }));
}
