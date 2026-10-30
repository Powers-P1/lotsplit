import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import type { AgGridReactProps } from 'ag-grid-react';

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  accentColor: '#244B3B', backgroundColor: '#FFFFFF', foregroundColor: '#1D2823',
  headerBackgroundColor: '#FFFFFF', headerTextColor: '#727A75', borderColor: '#E4E9E5',
  rowHoverColor: '#F7F9F7', selectedRowBackgroundColor: '#EFF5F1',
  fontFamily: 'Inter, system-ui, sans-serif', fontSize: 16, headerFontSize: 14,
  headerFontWeight: 400, headerHeight: 45, rowHeight: 68, cellHorizontalPadding: 18,
  wrapperBorder: false, rowBorder: true, columnBorder: false, headerColumnResizeHandleColor: 'transparent',
  borderRadius: 0, wrapperBorderRadius: 0,
});

export default function FlatGrid<T>({ className = '', ...props }: AgGridReactProps<T> & { className?: string }) {
  return <div className={`flat-grid ${className}`}><AgGridReact<T> theme={theme} domLayout="autoHeight" suppressCellFocus suppressMovableColumns animateRows={false} defaultColDef={{ sortable: false, resizable: false, flex: 1, suppressHeaderMenuButton: true }} {...props} /></div>;
}
