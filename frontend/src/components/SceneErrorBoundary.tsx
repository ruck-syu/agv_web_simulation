import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './ui/Icon';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unknown rendering error',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Warehouse viewport failed to render:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="scene-fallback">
          <Icon name="alert" size={25} />
          <h2>3D viewport unavailable</h2>
          <p>
            WebGL could not initialise in this browser. The dashboard and ROS connection controls
            remain functional.
          </p>
          <code>{this.state.message}</code>
        </div>
      );
    }

    return this.props.children;
  }
}
