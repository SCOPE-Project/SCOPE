import { Component } from 'react'

// The map renders imperative SVG against browser APIs jsdom and older
// engines do not all implement; a throw there must not take the whole
// workspace down with it.
export default class MapErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mission-map-shell">
          <div className="mission-map-state mission-map-state--error" role="alert">
            Map could not be initialized: {this.state.error.message}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
