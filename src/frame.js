import { MISSING_NODE } from './node';

/**
 * Stack frame.
 */
class Frame {

  constructor(node) {
    this.node = node;
    this.currentIndex = -1;
    this.stopResolution = false;
    this.variables = null;
    this.macros = null;
  }

  /**
   * Adds a variable to this frame.
   */
  setVar(name, node) {
    if (this.variables === null) {
      this.variables = {};
    }
    this.variables[name] = node;
  }

  /**
   * Returns a variable's value, or a missing node.
   */
  getVar(name) {
    const node = this.variables === null ? MISSING_NODE : this.variables[name];
    return typeof node === 'undefined' ? MISSING_NODE : node;
  }

  /**
   * Adds a macro to this frame.
   */
  setMacro(name, inst) {
    if (this.macros === null) {
      this.macros = {};
    }
    this.macros[name] = inst;
  }

  _getMacro(name) {
    const inst = this.macros === null ? null : this.macros[name];
    return inst || null;
  }
}

export default Frame;
