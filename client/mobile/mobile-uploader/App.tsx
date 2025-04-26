import { LogBox } from 'react-native';
import FileUploader from './src/components/FileUploader';

// Ignorar errores específicos de ScrollView que no podemos resolver directamente
LogBox.ignoreLogs([
  'VirtualizedLists should never be nested',
  'ScrollView child layout',
  'Warning: Invariant Violation: ScrollView child layout'
]);

export default function App() {
  return <FileUploader />;
}
