import { RouteLayer } from './RouteLayer';
import { LidarLayer } from './LidarLayer';
import { AgvModel } from '../robot/AgvModel';
import { WAREHOUSE_LAYOUT } from '../config/warehouseConfig';
import { RackRow } from './RackRow';
import { StagingArea } from './StagingArea';
import { WarehouseFloor } from './WarehouseFloor';
import { WarehouseLighting } from './WarehouseLighting';
import { WarehouseStructure } from './WarehouseStructure';
import { CollisionDebugLayer } from './CollisionDebugLayer';

export function WarehouseScene({ software = false }: { software?: boolean }) {
  return (
    <>
      <WarehouseLighting software={software} />
      <WarehouseFloor />
      <WarehouseStructure />
      <CollisionDebugLayer />
      <LidarLayer />
      <RouteLayer />
      {WAREHOUSE_LAYOUT.rack.rows.map((row) => (
        <RackRow key={row.id} row={row} />
      ))}
      <StagingArea />
      <AgvModel />
    </>
  );
}
