import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Customer, CustomerRegisteredDevice, RepairTicket } from '../../types';
import { useRepairStore } from '../../store/repairStore';
import { useCustomerStore } from '../../store/customerStore';
import { useToast } from '../../components/ui/Toast';
import { useTranslation } from 'react-i18next';

export function useCustomerDeviceActions(
  customer: Customer | null,
  setIsActionLoading: Dispatch<SetStateAction<boolean>>,
) {
  const { deleteTicket, deleteDeviceFromCustomer, updateDeviceForCustomer } = useRepairStore();
  const { updateCustomer } = useCustomerStore();
  const toast = useToast();
  const { t } = useTranslation();

  const [deviceToDelete, setDeviceToDelete] = useState<{ device: string; brand: string; model: string; tickets: RepairTicket[] } | null>(null);
  const [deleteDeviceRepairsToo, setDeleteDeviceRepairsToo] = useState(false);
  const [deviceToEdit, setDeviceToEdit] = useState<{ id?: string; oldBrand: string; oldModel: string; brand: string; model: string; imei?: string; notes?: string } | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<RepairTicket | null>(null);

  // Direct Ticket management in customer profile
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [ticketToEdit, setTicketToEdit] = useState<RepairTicket | null>(null);
  const [ticketPrefillDevice, setTicketPrefillDevice] = useState<string | undefined>(undefined);
  const [printingTicket, setPrintingTicket] = useState<RepairTicket | null>(null);

  // Phone / Device registration state
  const [isAddPhoneOpen, setIsAddPhoneOpen] = useState(false);
  const [newPhoneBrand, setNewPhoneBrand] = useState('');
  const [newPhoneModel, setNewPhoneModel] = useState('');
  const [newPhoneImei, setNewPhoneImei] = useState('');
  const [newPhoneNotes, setNewPhoneNotes] = useState('');
  const [createTicketForNewPhone, setCreateTicketForNewPhone] = useState(false);

  const confirmDeleteDevice = async () => {
    if (!customer || !deviceToDelete) return;
    setIsActionLoading(true);
    try {
      const brand = deviceToDelete.brand;
      const model = deviceToDelete.model;

      // Step 1: Optionally delete all linked repair tickets for this device
      let deletedTicketCount = 0;
      if (deleteDeviceRepairsToo && deviceToDelete.tickets.length > 0) {
        deletedTicketCount = await deleteDeviceFromCustomer(
          customer.id,
          customer.phone,
          brand,
          model
        );
      }

      // Step 2: Remove device from registeredDevices array
      if (customer.registeredDevices && customer.registeredDevices.length > 0) {
        const cleanBrand = brand.toLowerCase().trim();
        const cleanModel = model.toLowerCase().trim();
        const updatedDevs = customer.registeredDevices.filter(
          d => (d.brand || '').toLowerCase().trim() !== cleanBrand || (d.model || '').toLowerCase().trim() !== cleanModel
        );
        if (updatedDevs.length !== customer.registeredDevices.length) {
          await updateCustomer(customer.id, { registeredDevices: updatedDevs });
        }
      }

      const ticketMsg = deletedTicketCount > 0
        ? ` ${deletedTicketCount} repair ticket(s) also deleted.`
        : ' Repair history preserved.';
      toast.success(
        t('customers.deviceRemovedTitle', 'Device Removed'),
        t('customers.deviceRemovedDesc', '{{device}} removed from {{name}}\'s profile.{{ticketMsg}}', { device: deviceToDelete.device, name: customer.name, ticketMsg })
      );
      setDeviceToDelete(null);
      setDeleteDeviceRepairsToo(false);
    } catch (err) {
      toast.error(t('customers.removeDeviceError', 'Failed to remove device'), t('customers.anErrorOccurred', 'An error occurred.'));
    } finally {
      setIsActionLoading(false);
    }
  };

  const confirmEditDevice = async () => {
    if (!customer || !deviceToEdit) return;
    const { oldBrand, oldModel, brand, model, imei, notes } = deviceToEdit;
    if (!brand.trim() || !model.trim()) {
      toast.error(t('customers.validationError', 'Validation error'), t('customers.brandModelRequired', 'Both Brand and Model are required.'));
      return;
    }
    setIsActionLoading(true);
    try {
      const count = await updateDeviceForCustomer(
        customer.id,
        customer.phone,
        oldBrand,
        oldModel,
        brand.trim(),
        model.trim()
      );

      const cleanOldBrand = oldBrand.toLowerCase().trim();
      const cleanOldModel = oldModel.toLowerCase().trim();
      const existingDevices = customer.registeredDevices || [];
      const isAlreadyInRegistered = existingDevices.some(
        d => (d.brand || '').toLowerCase().trim() === cleanOldBrand && (d.model || '').toLowerCase().trim() === cleanOldModel
      );

      let updatedDevs: CustomerRegisteredDevice[];
      if (isAlreadyInRegistered) {
        updatedDevs = existingDevices.map(d => {
          if ((d.brand || '').toLowerCase().trim() === cleanOldBrand && (d.model || '').toLowerCase().trim() === cleanOldModel) {
            return {
              ...d,
              brand: brand.trim(),
              model: model.trim(),
              imei: imei !== undefined ? imei.trim() || undefined : d.imei,
              notes: notes !== undefined ? notes.trim() || undefined : d.notes,
            };
          }
          return d;
        });
      } else {
        const newDev: CustomerRegisteredDevice = {
          id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          brand: brand.trim(),
          model: model.trim(),
          imei: imei?.trim() || undefined,
          notes: notes?.trim() || undefined,
          createdAt: new Date().toISOString(),
        };
        updatedDevs = [...existingDevices, newDev];
      }

      await updateCustomer(customer.id, { registeredDevices: updatedDevs });

      toast.success(
        t('customers.deviceUpdatedTitle', 'Phone Device Updated'),
        t('customers.deviceUpdatedDesc', 'Updated to {{brand}} {{model}}{{countMsg}}.', {
          brand: brand.trim(),
          model: model.trim(),
          countMsg: count > 0 ? ` (${count} repair records updated)` : ''
        })
      );
      setDeviceToEdit(null);
    } catch (err) {
      toast.error(t('customers.updateDeviceError', 'Failed to update device'), t('customers.anErrorOccurred', 'An error occurred.'));
    } finally {
      setIsActionLoading(false);
    }
  };

  const confirmAddPhone = async () => {
    if (!customer) return;
    if (!newPhoneBrand.trim() || !newPhoneModel.trim()) {
      toast.error(t('customers.validationError', 'Validation error'), t('customers.provideBrandModel', 'Please provide both phone brand and model.'));
      return;
    }
    setIsActionLoading(true);
    try {
      const brand = newPhoneBrand.trim();
      const model = newPhoneModel.trim();
      const imei = newPhoneImei.trim() || undefined;
      const notes = newPhoneNotes.trim() || undefined;

      const existingDevices = customer.registeredDevices || [];
      const newDev: CustomerRegisteredDevice = {
        id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        brand,
        model,
        imei,
        notes,
        createdAt: new Date().toISOString(),
      };

      await updateCustomer(customer.id, {
        registeredDevices: [...existingDevices, newDev],
      });

      toast.success(
        t('customers.phoneAddedTitle', 'Phone Added'),
        t('customers.phoneAddedDesc', '{{brand}} {{model}} registered for {{name}}.', {
          brand,
          model,
          name: customer.name
        })
      );
      setIsAddPhoneOpen(false);
      setNewPhoneBrand('');
      setNewPhoneModel('');
      setNewPhoneImei('');
      setNewPhoneNotes('');

      if (createTicketForNewPhone) {
        setTicketPrefillDevice(`${brand} ${model}`);
        setTicketToEdit(null);
        setIsNewTicketOpen(true);
      }
    } catch (err) {
      toast.error(t('customers.addPhoneError', 'Failed to add phone'), t('customers.anErrorOccurred', 'An error occurred.'));
    } finally {
      setIsActionLoading(false);
    }
  };

  const confirmDeleteSingleTicket = async () => {
    if (!ticketToDelete) return;
    setIsActionLoading(true);
    try {
      await deleteTicket(ticketToDelete.id);
      toast.success(
        t('customers.ticketDeletedTitle', 'Repair Ticket Deleted'),
        t('customers.ticketDeletedDesc', 'Ticket #{{number}} was deleted.', { number: ticketToDelete.ticketNumber })
      );
      setTicketToDelete(null);
    } catch (err) {
      toast.error(t('customers.deleteTicketError', 'Failed to delete ticket'), t('customers.anErrorOccurred', 'An error occurred.'));
    } finally {
      setIsActionLoading(false);
    }
  };

  return {
    deviceToDelete,
    setDeviceToDelete,
    deleteDeviceRepairsToo,
    setDeleteDeviceRepairsToo,
    deviceToEdit,
    setDeviceToEdit,
    ticketToDelete,
    setTicketToDelete,
    isNewTicketOpen,
    setIsNewTicketOpen,
    ticketToEdit,
    setTicketToEdit,
    ticketPrefillDevice,
    setTicketPrefillDevice,
    printingTicket,
    setPrintingTicket,
    isAddPhoneOpen,
    setIsAddPhoneOpen,
    newPhoneBrand,
    setNewPhoneBrand,
    newPhoneModel,
    setNewPhoneModel,
    newPhoneImei,
    setNewPhoneImei,
    newPhoneNotes,
    setNewPhoneNotes,
    createTicketForNewPhone,
    setCreateTicketForNewPhone,
    confirmDeleteDevice,
    confirmEditDevice,
    confirmAddPhone,
    confirmDeleteSingleTicket,
  };
}
