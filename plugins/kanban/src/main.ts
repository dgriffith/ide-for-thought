/**
 * The Kanban plugin's view (#2828). C1: the build and serving, with a view
 * that connects and says what it was given; the board itself moves here in C2.
 */
import { mount } from 'svelte';
import { connect } from '/@minerva/plugin-api.js';
import App from './App.svelte';

const target = document.getElementById('app');
if (target) {
  void connect().then((minerva) => mount(App, { target, props: { minerva } }));
}
